/** Rebuild the six instrument packages. Requires curl, 7-Zip, ffmpeg and npm ci.
 * Source downloads are pinned and cached under output/music-source.
 * No full library is shipped to the browser. See public/music/README.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';

const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, 'output/music-source');
const out = path.join(root, 'public/music');
const GU = '684543d5e5efaef08d02be50dcda8d552478fa60';
const VCSL = 'dfcf4a4918771eee884b96ad4493de82ef84daf6';
const velocity = 96;
const sourceLog = [];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(cache, { recursive: true });
await fs.mkdir(out, { recursive: true });

function raw(repo, revision, file) {
  return `https://raw.githubusercontent.com/${repo}/${revision}/${file.split('/').map(encodeURIComponent).join('/')}`;
}
async function download(url, filename) {
  const file = path.join(cache, filename);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.access(file); } catch {
    execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '3', '--output', file, url], { stdio: 'inherit' });
  }
  const bytes = await fs.readFile(file);
  sourceLog.push({ url, file: filename.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) });
  return { file, bytes };
}
const arrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loadBank = (bytes) => SoundBankLoader.fromArrayBuffer(arrayBuffer(bytes));
function summarizeBank(bank) {
  return bank.presets.map((preset) => ({
    name: preset.name, program: preset.program, bank: preset.bankMSB,
    zones: preset.zones.map((zone) => ({
      keyRange: zone.keyRange, velocityRange: zone.velRange,
      generators: zone.generators, modulators: zone.modulators,
      instrument: zone.instrument.name,
      instrumentGlobalGenerators: zone.instrument.globalZone.generators,
      samples: zone.instrument.zones.map((sample) => ({
        name: sample.sample.name, keyRange: sample.keyRange, velocityRange: sample.velRange,
        root: sample.sample.originalKey, correctionCents: sample.sample.pitchCorrection,
        sampleRate: sample.sample.sampleRate, loopStart: sample.sample.loopStart, loopEnd: sample.sample.loopEnd,
        generators: sample.generators, modulators: sample.modulators,
      })),
    })),
  }));
}
const packages = [];
const gu = await download(raw('mrbumpy409/GeneralUser-GS', GU, 'GeneralUser-GS.sf2'), 'GeneralUser-GS.sf2');
const guLicense = await download(raw('mrbumpy409/GeneralUser-GS', GU, 'documentation/LICENSE.txt'), 'GeneralUser-LICENSE.txt');
await fs.writeFile(path.join(out, 'GeneralUser-LICENSE.txt'), guLicense.bytes);
const guBank = loadBank(gu.bytes);
for (const [id, program] of [['gu-piano', 0], ['gu-harmonica', 22], ['gu-guitar', 24]]) {
  const preset = guBank.presets.find((p) => p.program === program && p.bankMSB === 0 && !p.isGMGSDrum);
  if (!preset) throw new Error(`Missing GeneralUser preset ${program}`);
  const subset = new BasicSoundBank();
  subset.soundBankInfo = { ...guBank.soundBankInfo };
  subset.defaultModulators = guBank.defaultModulators;
  subset.customDefaultModulators = guBank.customDefaultModulators;
  subset.clonePreset(preset);
  const bytes = Buffer.from(subset.writeSF2());
  await fs.writeFile(path.join(out, `${id}.sf2`), bytes);
  await fs.writeFile(path.join(out, `${id}-mapping.json`), JSON.stringify(summarizeBank(subset), null, 2) + '\n');
  packages.push({ id, bytes: bytes.length, sha256: sha256(bytes), samples: subset.samples.length, program, bank: 0 });
}

const guitar = await download('https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SF2-20190618.7z', 'freepats.7z');
const sevenZip = process.env.SEVEN_ZIP || (process.platform === 'win32' ? 'C:/Program Files/7-Zip/7z.exe' : '7z');
execFileSync(sevenZip, ['x', guitar.file, `-o${path.join(cache, 'freepats')}`, '-y'], { stdio: 'ignore' });
const guitarDir = path.join(cache, 'freepats/SpanishClassicalGuitar-SF2-20190618');
const guitarBytes = await fs.readFile(path.join(guitarDir, 'SpanishClassicalGuitar-20190618.sf2'));
const guitarBank = loadBank(guitarBytes);
await fs.writeFile(path.join(out, 'freepats-guitar.sf2'), guitarBytes);
await fs.copyFile(path.join(guitarDir, 'cc0.txt'), path.join(out, 'CC0-1.0.txt'));
await fs.copyFile(path.join(guitarDir, 'readme.txt'), path.join(out, 'FreePats-README.txt'));
await fs.writeFile(path.join(out, 'freepats-guitar-mapping.json'), JSON.stringify(summarizeBank(guitarBank), null, 2) + '\n');
packages.push({ id: 'freepats-guitar', bytes: guitarBytes.length, sha256: sha256(guitarBytes), samples: guitarBank.samples.length, program: guitarBank.presets[0].program, bank: guitarBank.presets[0].bankMSB });

function parseSfz(text) {
  // These two pinned SFZs use newline-delimited opcodes and separate attack/release groups.
  const attack = text.replace(/^\s*\/\/.*$/gm, '').split('<group>')[1];
  return attack.split('<region>').slice(1).map((section) => Object.fromEntries(section.trim().split(/\r?\n/)
    .filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])))
    .filter((zone) => zone.sample && +(zone.lovel || 0) <= velocity && +(zone.hivel || 127) >= velocity);
}
function readWav(bytes) {
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (name === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + length);
    if (name === 'data') data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  if (!format || !data || format.readUInt16LE(0) !== 1) throw new Error('Expected PCM WAV');
  return { format, data, channels: format.readUInt16LE(2), rate: format.readUInt32LE(4), bits: format.readUInt16LE(14), frameBytes: format.readUInt16LE(12) };
}
function writeWav(wav) {
  const pad = wav.data.length % 2;
  const result = Buffer.alloc(44 + wav.data.length + pad);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); wav.format.copy(result, 20, 0, 16); result.write('data', 36);
  result.writeUInt32LE(wav.data.length, 40); wav.data.copy(result, 44); return result;
}
function configureSustain(wav) {
  // Keep the natural attack. Blend the END of a stable body segment into the body
  // immediately BEFORE the loop start: at the wrap, playback proceeds continuously
  // from that preceding sample into loopStart. Attack is never in the loop.
  const frames = Math.floor(wav.data.length / wav.frameBytes);
  const start = Math.round(wav.rate * 0.65);
  const end = Math.min(Math.round(wav.rate * 2.35), frames - Math.round(wav.rate * 0.3));
  const crossfade = Math.round(wav.rate * 0.2);
  if (end - start < wav.rate * 0.5 || start <= crossfade) throw new Error('Insufficient harmonica sustain body');
  const bps = wav.bits / 8;
  const data = Buffer.from(wav.data);
  for (let frame = 0; frame < crossfade; frame++) {
    const fraction = frame / (crossfade - 1);
    // Smooth equal-gain transition (same correlated reed tone, avoiding a +3dB bump).
    const mix = fraction * fraction * (3 - 2 * fraction);
    for (let channel = 0; channel < wav.channels; channel++) {
      const tail = ((end - crossfade + frame) * wav.channels + channel) * bps;
      const head = ((start - crossfade + frame) * wav.channels + channel) * bps;
      const a = wav.data.readIntLE(tail, bps), b = wav.data.readIntLE(head, bps);
      data.writeIntLE(Math.round(a * (1 - mix) + b * mix), tail, bps);
    }
  }
  return { wav: { ...wav, data }, loopStart: start / wav.rate, loopEnd: end / wav.rate, crossfadeFrames: crossfade };
}

for (const [id, sfzPath] of [
  ['vcsl-piano', 'Chordophones/Zithers/Grand Piano, Kawai - Legacy.sfz'],
  ['vcsl-harmonica', 'Aerophones/Free Aerophones/Harmonica-Hohner-Super64 - Normal.sfz'],
]) {
  const directory = path.join(out, id);
  await fs.mkdir(directory, { recursive: true });
  const sfz = await download(raw('sgossner/VCSL', VCSL, sfzPath), `${id}/original.sfz`);
  await fs.writeFile(path.join(directory, 'original.sfz'), sfz.bytes);
  const regions = parseSfz(sfz.bytes.toString('utf8'));
  const samples = [];
  let totalBytes = 0;
  for (const region of regions) {
    const sourcePath = path.posix.join(path.posix.dirname(sfzPath), region.sample);
    const downloaded = await download(raw('sgossner/VCSL', VCSL, sourcePath), `${id}/${path.posix.basename(region.sample)}`);
    const parsed = readWav(downloaded.bytes);
    const offset = +(region.offset || 0);
    const trimmed = { ...parsed, data: parsed.data.subarray(offset * parsed.frameBytes) };
    const loop = id === 'vcsl-harmonica' ? configureSustain(trimmed) : null;
    const filename = `note-${region.pitch_keycenter}.flac`;
    const processed = path.join(cache, id, `processed-${region.pitch_keycenter}.wav`);
    await fs.writeFile(processed, writeWav(loop?.wav || trimmed));
    execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', processed, '-c:a', 'flac', '-compression_level', '8', path.join(directory, filename)]);
    const output = await fs.readFile(path.join(directory, filename));
    totalBytes += output.length;
    samples.push({
      url: `/music/${id}/${filename}`,
      root: +region.pitch_keycenter - +(region.tune || 0) / 100,
      low: +region.lokey, high: +region.hikey,
      gain: 10 ** (+(region.volume || 0) / 20),
      ...(loop ? { loopStart: loop.loopStart, loopEnd: loop.loopEnd } : {}),
      source: sourcePath, sourceVelocityRange: [+(region.lovel || 0), +(region.hivel || 127)],
      sourceRoot: +region.pitch_keycenter, sourceTuneCents: +(region.tune || 0), sourceOffsetFrames: offset,
      ...(loop ? { loopCrossfadeFrames: loop.crossfadeFrames } : {}),
      sampleRate: parsed.rate, frames: trimmed.data.length / parsed.frameBytes,
      channels: parsed.channels, sha256: sha256(output), bytes: output.length,
    });
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: `${VCSL.slice(0, 12)}-v1`, fixedVelocity: velocity, samples }, null, 2) + '\n');
  packages.push({ id, bytes: totalBytes, samples: samples.length, range: [samples[0].low, samples.at(-1).high] });
}
const vcslLicense = await download(raw('sgossner/VCSL', VCSL, 'README.md'), 'VCSL-README.md');
await fs.writeFile(path.join(out, 'VCSL-README.md'), vcslLicense.bytes);
await fs.writeFile(path.join(out, 'sources.json'), JSON.stringify({ formatVersion: 1, generalUserCommit: GU, vcslCommit: VCSL, freepatsVersion: '2019-06-18', fixedVelocity: velocity, packages, sources: sourceLog }, null, 2) + '\n');
console.log(JSON.stringify(packages, null, 2));

// A fixed, disclosed level-matching protocol (not subjective listening): independent
// MIDI 60/64/67 notes, velocity 96, dry stereo, first second, CC7/11=127.
// A single preset gain targets mean RMS 0.06; a 0.65 peak cap retains headroom.
const reference = [60, 64, 67];
const levels = [];
for (const pkg of packages) {
  const measurements = [];
  for (const pitch of reference) {
    let channels;
    if (pkg.id.startsWith('vcsl-')) {
      const manifest = JSON.parse(await fs.readFile(path.join(out, pkg.id, 'manifest.json'), 'utf8'));
      const zone = manifest.samples.find((sample) => pitch >= sample.low && pitch <= sample.high);
      const raw = execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'public', zone.url), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 32 * 1024 * 1024 });
      const source = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      channels = Array.from({ length: 2 }, () => new Float32Array(44100));
      const rate = 2 ** ((pitch - zone.root) / 12) * zone.sampleRate / 44100;
      for (let frame = 0; frame < 44100; frame++) {
        const position = frame * rate, first = Math.floor(position), fraction = position - first;
        const envelope = Math.min(1, frame / (44100 * 0.004)) * zone.gain * velocity / 127;
        for (let channel = 0; channel < 2; channel++) {
          const sourceChannel = Math.min(channel, zone.channels - 1);
          const a = source[first * zone.channels + sourceChannel] || 0;
          const b = source[(first + 1) * zone.channels + sourceChannel] || 0;
          channels[channel][frame] = (a + (b - a) * fraction) * envelope;
        }
      }
    } else {
      const bytes = await fs.readFile(path.join(out, `${pkg.id}.sf2`));
      const synth = new SpessaSynthProcessor(44100, { maxBufferSize: 128, effectsEnabled: false, eventsEnabled: false });
      await synth.processorInitialized;
      synth.soundBankManager.addSoundBank(loadBank(bytes), pkg.id);
      synth.controllerChange(0, 7, 127); synth.controllerChange(0, 11, 127);
      synth.programChange(0, pkg.program);
      synth.noteOn(0, pitch, velocity);
      channels = [new Float32Array(44100), new Float32Array(44100)];
      for (let offset = 0; offset < 44100; offset += 128) synth.process(channels[0], channels[1], offset, Math.min(128, 44100 - offset));
    }
    let peak = 0, sum = 0;
    for (const channel of channels) for (const sample of channel) { peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; }
    measurements.push({ pitch, rms: Math.sqrt(sum / 88200), peak });
  }
  const meanRms = measurements.reduce((sum, value) => sum + value.rms, 0) / measurements.length;
  const peak = Math.max(...measurements.map((value) => value.peak));
  if (!(meanRms > 0) || !Number.isFinite(meanRms)) throw new Error(`Silent reference ${pkg.id}`);
  levels.push({ id: pkg.id, measurements, defaultGain: Math.round(Math.min(0.06 / meanRms, 0.65 / peak, 16) * 1000) / 1000 });
}
await fs.writeFile(path.join(out, 'level-reference.json'), JSON.stringify({ protocol: 'Mean first-second dry stereo RMS, separate MIDI60/64/67 at velocity96, CC7/11=127, 128-frame synthesis blocks, target0.06, maximum reference peak0.65, gain cap16. No listening test implied.', levels }, null, 2) + '\n');
console.log('Recommended default gains:', levels.map(({ id, defaultGain }) => ({ id, defaultGain })));
