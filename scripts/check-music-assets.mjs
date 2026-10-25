import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';

const directory = path.resolve('public/music');
const sources = JSON.parse(await fs.readFile(path.join(directory, 'sources.json'), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sources.packages.length, 6);
assert.equal(sources.fixedVelocity, 96);
assert.equal(sources.generalUserCommit, '684543d5e5efaef08d02be50dcda8d552478fa60');
assert.equal(sources.vcslCommit, 'dfcf4a4918771eee884b96ad4493de82ef84daf6');
let bytes = 0;
for (const pkg of sources.packages) {
  if (pkg.id.startsWith('vcsl-')) {
    const originalMapping = await fs.readFile(path.join(directory, pkg.id, 'original.sfz'));
    const mappingSource = sources.sources.find((source) => source.file === `${pkg.id}/original.sfz`);
    assert.equal(digest(originalMapping), mappingSource.sha256, `${pkg.id}: original SFZ remains byte-identical`);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, pkg.id, 'manifest.json'), 'utf8'));
    assert.equal(manifest.samples.length, pkg.samples);
    assert.equal(manifest.fixedVelocity, 96);
    let size = 0;
    for (let pitch = pkg.range[0]; pitch <= pkg.range[1]; pitch++) {
      assert.equal(manifest.samples.filter((zone) => pitch >= zone.low && pitch <= zone.high).length, 1, `${pkg.id}: exactly one region at ${pitch}`);
    }
    for (const sample of manifest.samples) {
      const filename = path.resolve('public', `.${sample.url}`);
      assert(filename.startsWith(directory + path.sep));
      const audio = await fs.readFile(filename);
      assert.equal(audio.toString('ascii', 0, 4), 'fLaC');
      assert.equal(digest(audio), sample.sha256);
      assert.equal(audio.length, sample.bytes);
      assert.equal(sample.root, sample.sourceRoot - sample.sourceTuneCents / 100);
      assert(sample.sourceVelocityRange[0] <= 96 && sample.sourceVelocityRange[1] >= 96);
      assert(sample.gain > 0 && Number.isFinite(sample.gain));
      if (pkg.id === 'vcsl-harmonica') {
        assert(sample.loopStart > 0.4, 'Attack remains outside sustain loop');
        assert(sample.loopEnd > sample.loopStart + 0.5);
        assert(sample.loopEnd < sample.frames / sample.sampleRate);
        assert.equal(sample.loopCrossfadeFrames, Math.round(sample.sampleRate * 0.2));
      } else {
        assert.equal(sample.loopStart, undefined);
        assert.equal(sample.loopEnd, undefined);
      }
      size += audio.length;
    }
    assert.equal(size, pkg.bytes);
  } else {
    const audio = await fs.readFile(path.join(directory, `${pkg.id}.sf2`));
    assert.equal(audio.length, pkg.bytes);
    assert.equal(digest(audio), pkg.sha256);
    const bank = SoundBankLoader.fromArrayBuffer(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));
    assert.equal(bank.presets.length, 1, 'Exactly the selected instrument is shipped');
    assert.equal(bank.presets[0].program, pkg.program);
    assert.equal(bank.presets[0].bankMSB, pkg.bank);
    assert.equal(bank.samples.length, pkg.samples);
    const synth = new SpessaSynthProcessor(44100, { maxBufferSize: 128, effectsEnabled: false, eventsEnabled: false });
    await synth.processorInitialized;
    synth.soundBankManager.addSoundBank(bank, pkg.id);
    synth.programChange(0, pkg.program);
    synth.noteOn(0, 60, 96);
    let peak = 0;
    for (let frame = 0; frame < 400; frame++) {
      const left = new Float32Array(128), right = new Float32Array(128);
      synth.process(left, right);
      for (const value of [...left, ...right]) { assert(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); }
    }
    assert(peak > 0.0001, `${pkg.id}: reference note is audible data`);
    synth.noteOff(0, 60);
  }
  bytes += pkg.bytes;
}
assert(bytes < 50 * 1024 * 1024, 'Bounded total packaged instrument payload');
for (const license of ['GeneralUser-LICENSE.txt', 'CC0-1.0.txt', 'VCSL-README.md', 'FreePats-README.txt']) {
  assert((await fs.readFile(path.join(directory, license), 'utf8')).length > 100);
}
const levels = JSON.parse(await fs.readFile(path.join(directory, 'level-reference.json'), 'utf8'));
for (const item of levels.levels) {
  const mean = item.measurements.reduce((sum, note) => sum + note.rms, 0) / 3 * item.defaultGain;
  assert(Math.abs(mean - 0.06) < 0.001, `${item.id}: coordinated reference level`);
}
console.log('PASS music assets: 6 real presets; pinned hashes; complete source mappings; bounded sustain loops; SF2 rendering; licenses; coordinated reference levels.');
