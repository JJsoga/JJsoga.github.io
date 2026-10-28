import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function load(relative) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { EXPORT_CONFIG, createExportPlan, encodeWav, measureStereoPeak, commonExportGain, createStoredZip, createStoredZipParts, trackFilename, crc32 } = await load('../src/scripts/music/export-format.ts');
const { moveClip, trimClip, splitClip } = await load('../src/scripts/music/model.ts');
const { PRESETS } = await load('../src/scripts/music/presets.ts');
const preset = id => { const found = PRESETS.find(value => value.id === id); return { id: found.id, version: found.version }; };
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
function fixture() {
  return {
    version: 1,
    tracks: [
      { id: 'piano', name: '../Untrusted: title', instrument: 'piano', presetId: 'vcsl-piano', volume: 0.2,
        clips: [{ id: 'first', takeId: 'piano-take', start: 3, sourceStart: 0, duration: 8 }] },
      { id: 'silent', name: 'Silent', instrument: 'guitar', presetId: 'gu-guitar', volume: 0.7,
        clips: [{ id: 'silent', takeId: 'silent-take', start: 20, sourceStart: 0, duration: 2 }] },
      { id: 'harmonica', name: 'Harmonica', instrument: 'harmonica', presetId: 'gu-harmonica', volume: 0.7,
        clips: [{ id: 'second', takeId: 'harmonica-take', start: 2, sourceStart: 0, duration: 4 }] },
      { id: 'empty', name: 'Empty', instrument: 'piano', presetId: 'gu-piano', volume: 0.7, clips: [] },
    ],
    takes: {
      'piano-take': { id: 'piano-take', preset: preset('gu-piano'), gain: 0.7, duration: 8,
        notes: [{ id: 'long', pitch: 60, start: 1, duration: 6, velocity: 96 },
          { id: 'unison', pitch: 60, start: 2, duration: 1, velocity: 85 }] },
      'silent-take': { id: 'silent-take', preset: preset('gu-guitar'), gain: 0, duration: 2,
        notes: [{ id: 'silent', pitch: 52, start: 0, duration: 1, velocity: 96 }] },
      'harmonica-take': { id: 'harmonica-take', preset: preset('vcsl-harmonica'), gain: 0.4, duration: 4,
        notes: [{ id: 'held', pitch: 67, start: 0, duration: 4, velocity: 96 }] },
    },
  };
}
function viewOf(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function textAt(bytes, start, length) { return new TextDecoder().decode(bytes.subarray(start, start + length)); }

check('plans omit empty/zero-volume tracks while preserving full timeline alignment and exact presets', () => {
  const plan = createExportPlan(freeze(fixture()));
  assert.equal(plan.timelineStart, 0);
  assert.equal(plan.arrangementDuration, 22); // Includes original trailing silent clip.
  assert.equal(plan.tailDuration, 8);
  assert.equal(plan.duration, 30);
  assert.equal(plan.frameCount, 30 * 44100);
  assert.equal(plan.sampleRate, 44100);
  assert.equal(plan.channels, 2);
  assert.equal(plan.bitDepth, 16);
  assert.equal(plan.omittedTrackCount, 2);
  assert.deepEqual(plan.tracks.map(track => [track.trackId, track.filename]), [
    ['piano', '01-piano.wav'], ['harmonica', '02-harmonica.wav'],
  ]);
  assert.deepEqual(plan.presets.map(value => value.id), ['gu-piano', 'vcsl-harmonica']);
  assert.equal(plan.events.length, 3);
  assert.equal(plan.events[0].start, 2);
  assert.equal(plan.tracks[0].events[0].start, 4);
  assert.equal(plan.tracks[0].events[0].gain, 0.7);
});

check('planning cannot rewrite takes or substitute current performance settings', () => {
  const project = fixture();
  const original = JSON.stringify(project);
  const before = createExportPlan(project);
  assert.equal(JSON.stringify(project), original);
  project.tracks[0].presetId = 'a-current-setting-that-is-not-a-recorded-preset';
  project.tracks[0].volume = 0;
  assert.deepEqual(createExportPlan(project), before);
  before.presets[0].range[0] = 90;
  before.tracks[0].events[0].preset.version = 'changed only in an export result';
  const next = createExportPlan(project);
  assert.equal(next.presets[0].range[0], 21);
  assert.equal(next.tracks[0].events[0].preset.version, preset('gu-piano').version);
  assert.equal(project.takes['piano-take'].notes[0].pitch, 60);
});

check('moved, trimmed and split clips retain timing, source offsets and independent unison notes', () => {
  const project = fixture();
  project.tracks = [project.tracks[0]];
  const baseline = createExportPlan(project);
  const original = project.tracks[0].clips[0];
  const compare = events => events.map(({ id, ...event }) => event);
  project.tracks[0].clips = splitClip(original, 7);
  assert.deepEqual(compare(createExportPlan(project).events), compare(baseline.events));
  assert.equal(createExportPlan(project).events.length, 2);
  project.tracks[0].clips = [trimClip(moveClip(original, 10), 2, 4, 8)];
  const plan = createExportPlan(project);
  assert.deepEqual(plan.events.map(event => ({ start: event.start, duration: event.duration, offset: event.sourceOffset, pitch: event.pitch })), [
    { start: 12, duration: 4, offset: 1, pitch: 60 }, { start: 12, duration: 1, offset: 0, pitch: 60 },
  ]);
  assert.equal(plan.duration, 24);
  assert.equal(project.takes['piano-take'].notes[0].duration, 6);
});

check('missing versions, wrong instrument/range and empty exports fail clearly; tails remain bounded', () => {
  for (const mutation of [
    project => { project.takes['piano-take'].preset.version = 'unavailable'; },
    project => { project.takes['piano-take'].preset.id = 'missing'; },
    project => { project.takes['piano-take'].notes[0].pitch = 20; },
    project => { project.tracks[0].instrument = 'harmonica'; },
    project => { project.tracks[1].id = project.tracks[0].id; },
    project => { project.tracks[0].clips[0].start = 119; },
  ]) {
    const project = fixture(); mutation(project); assert.throws(() => createExportPlan(project));
  }
  const empty = fixture(); empty.tracks.forEach(track => { track.clips = []; });
  assert.throws(() => createExportPlan(empty), /audible note/);
  const silent = fixture(); Object.values(silent.takes).forEach(take => { take.gain = 0; });
  assert.throws(() => createExportPlan(silent), /audible note/);
  const guitar = fixture();
  guitar.tracks = [{ ...guitar.tracks[1], clips: [{ id: 'last', takeId: 'silent-take', start: 118, sourceStart: 0, duration: 2 }] }];
  guitar.takes['silent-take'].preset = preset('freepats-guitar');
  guitar.takes['silent-take'].gain = 0.7;
  const plan = createExportPlan(guitar);
  assert.equal(plan.tailDuration, 12);
  assert.equal(plan.duration, 132);
  assert.equal(plan.frameCount, EXPORT_CONFIG.maxFrames);
});

check('PCM WAV headers, stereo interleaving, saturation and peak metadata match known samples', () => {
  const left = Float32Array.of(0, 0.5, -0.5, 1), right = Float32Array.of(1, -1, 1.5, -1.5);
  const measurement = measureStereoPeak(left, right);
  assert.deepEqual(measurement, { peak: 1.5, clippedSamples: 2, frames: 4 });
  const bytes = encodeWav(left, right), view = viewOf(bytes);
  assert.equal(textAt(bytes, 0, 4), 'RIFF'); assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(textAt(bytes, 8, 4), 'WAVE'); assert.equal(textAt(bytes, 12, 4), 'fmt ');
  assert.equal(view.getUint32(16, true), 16); assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(28, true), 176400); assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 16); assert.equal(textAt(bytes, 36, 4), 'data');
  assert.equal(view.getUint32(40, true), 16);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => view.getInt16(44 + index * 2, true)),
    [0, 32767, 16384, -32768, -16384, 32767, 32767, -32768]);
  assert.deepEqual([...left], [0, 0.5, -0.5, 1]);
});

check('all stems share sample length and a single attenuation preserves their sum', () => {
  const a = Float32Array.of(1.5, -0.7, 0.5, -0.1), b = Float32Array.of(-1.3, 0.4, 0.3, 0.05);
  const mix = Float32Array.from(a, (value, index) => value + b[index]);
  const peak = Math.max(measureStereoPeak(a, a).peak, measureStereoPeak(b, b).peak, measureStereoPeak(mix, mix).peak);
  const gain = commonExportGain(peak);
  assert.equal(gain, 0.98 / 1.5); // Cancellation in the mix cannot hide an overloaded individual stem.
  const wavA = encodeWav(a, a, gain), wavB = encodeWav(b, b, gain), wavMix = encodeWav(mix, mix, gain);
  assert.equal(wavA.length, wavMix.length); assert.equal(wavB.length, wavMix.length);
  for (let i = 0; i < a.length * 2; i++) {
    const offset = 44 + i * 2;
    const sum = viewOf(wavA).getInt16(offset, true) + viewOf(wavB).getInt16(offset, true);
    assert.ok(Math.abs(sum - viewOf(wavMix).getInt16(offset, true)) <= 2, 'Stem sums differ only by PCM quantization');
  }
  assert.equal(commonExportGain(0), 1); assert.equal(commonExportGain(0.5), 1); assert.equal(commonExportGain(1), 1);
  assert.ok(commonExportGain(1.001) < 1);
  const planProject = fixture();
  planProject.tracks = planProject.tracks.filter(track => ['piano', 'harmonica'].includes(track.id));
  for (const track of planProject.tracks) track.clips = [{ id: track.id, takeId: track.clips[0].takeId, start: 0, sourceStart: 0, duration: 0.02 }];
  planProject.takes['piano-take'].notes[0].start = 0;
  const plan = createExportPlan(planProject);
  const silence = new Float32Array(plan.frameCount);
  const stemA = encodeWav(silence, silence), stemB = encodeWav(silence, silence);
  assert.equal((stemA.length - 44) / 4 / 44100, plan.duration);
  assert.equal(stemA.length, stemB.length);
});

check('invalid PCM, attenuation and duration inputs are rejected before export', () => {
  for (const channels of [
    [new Float32Array(), new Float32Array()], [Float32Array.of(1), Float32Array.of(1, 2)],
    [Float32Array.of(NaN), Float32Array.of(0)], [Float32Array.of(0), Float32Array.of(Infinity)],
  ]) {
    assert.throws(() => encodeWav(...channels), RangeError);
    assert.throws(() => measureStereoPeak(...channels), RangeError);
  }
  const excessive = new Float32Array(EXPORT_CONFIG.maxFrames + 1);
  assert.throws(() => encodeWav(excessive, excessive), /duration limit/);
  for (const gain of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => encodeWav(Float32Array.of(0), Float32Array.of(0), gain), RangeError);
  for (const peak of [-1, NaN, Infinity]) assert.throws(() => commonExportGain(peak), RangeError);
});

check('stored ZIP archives have valid local/central records, deterministic data and CRC32', () => {
  const text = new TextEncoder();
  assert.equal(crc32(text.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  const files = [
    { name: '01-piano.wav', data: encodeWav(Float32Array.of(0, 0.5), Float32Array.of(0.5, 0)) },
    { name: 'manifest.json', data: text.encode('{"timelineStart":0,"normalized":false}') },
  ];
  const archive = createStoredZip(files), view = viewOf(archive);
  assert.deepEqual(createStoredZip(files), archive);
  const parts = createStoredZipParts(files);
  assert.equal(parts.length, files.length * 2 + 1);
  assert.equal(parts[1], files[0].data, 'The first WAV payload is referenced, not copied');
  assert.equal(parts[3], files[1].data, 'The manifest payload is referenced, not copied');
  assert.deepEqual(new Uint8Array(Buffer.concat(parts)), archive, 'Concatenated Blob-ready parts are byte-identical to the archive');
  assert.ok(parts.filter((_, index) => index % 2 === 0).reduce((sum, part) => sum + part.length, 0) < 1024,
    'Only small header and central-directory buffers are added');
  const end = archive.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 8, true), 2); assert.equal(view.getUint16(end + 10, true), 2);
  let local = 0, central = view.getUint32(end + 16, true);
  const directoryStart = central;
  for (const file of files) {
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint16(local + 8, true), 0); // No compression.
    assert.equal(view.getUint16(local + 6, true), 0x0800);
    assert.equal(view.getUint32(local + 14, true), crc32(file.data));
    assert.equal(view.getUint32(local + 18, true), file.data.length);
    assert.equal(view.getUint32(local + 22, true), file.data.length);
    const nameLength = view.getUint16(local + 26, true);
    assert.equal(textAt(archive, local + 30, nameLength), file.name);
    assert.deepEqual(archive.subarray(local + 30 + nameLength, local + 30 + nameLength + file.data.length), file.data);
    assert.equal(view.getUint32(central, true), 0x02014b50);
    assert.equal(view.getUint32(central + 16, true), crc32(file.data));
    assert.equal(view.getUint32(central + 42, true), local);
    assert.equal(textAt(archive, central + 46, nameLength), file.name);
    local += 30 + nameLength + file.data.length; central += 46 + nameLength;
  }
  assert.equal(local, directoryStart); assert.equal(central, end);
  assert.equal(view.getUint32(end + 12, true), end - directoryStart);
});

check('archive filenames and allocations are bounded without trusting visible track names', () => {
  assert.equal(trackFilename(3, 'guitar'), '03-nylon-guitar.wav');
  for (const index of [0, 9, 1.5, NaN]) assert.throws(() => trackFilename(index, 'piano'), RangeError);
  assert.throws(() => trackFilename(1, 'constructor'), RangeError);
  const data = Uint8Array.of(1);
  for (const name of ['../bad.wav', '/bad.wav', 'folder/bad.wav', 'bad\\name.wav', 'bad:name.wav', 'CON.wav', 'a..b.wav', '', 'a'.repeat(101), 'bad.']) {
    assert.throws(() => createStoredZip([{ name, data }]), /filenames/);
  }
  assert.throws(() => createStoredZip([{ name: 'a.wav', data }, { name: 'A.wav', data }]), /unique/);
  assert.throws(() => createStoredZip([]), /entries/);
  assert.throws(() => createStoredZip(Array.from({ length: 10 }, (_, i) => ({ name: `${i}.wav`, data }))), /entries/);
  const maximumWav = new Uint8Array(44 + EXPORT_CONFIG.maxFrames * 4);
  assert.ok(EXPORT_CONFIG.maxArchiveEntries * (maximumWav.length + 30 + 46 + 200) + 22 < EXPORT_CONFIG.maxArchiveBytes,
    'Even the maximum permitted entry count and lengths fit the total archive allocation budget');
  assert.throws(() => createStoredZip([{ name: 'oversized.wav', data: new Uint8Array(maximumWav.length + 1) }]), /resource limit/);
});

console.log(`${checks} music export planning and format checks passed. Audio rendering and browser downloads are verified separately.`);
