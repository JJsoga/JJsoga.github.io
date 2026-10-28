import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function load(relative) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { SoundFontRenderer } = await load('../src/scripts/music/export-soundfont.worker.ts');
const { PRESETS } = await load('../src/scripts/music/presets.ts');
const rate = 44100;
const sfPresets = PRESETS.filter(preset => preset.kind === 'soundfont');
const piano = sfPresets.find(preset => preset.id === 'gu-piano');
const harmonica = sfPresets.find(preset => preset.id === 'gu-harmonica');
const renderer = new SoundFontRenderer();
const fetchCounts = new Map();
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const pathname = new URL(url).pathname;
  fetchCounts.set(pathname, (fetchCounts.get(pathname) ?? 0) + 1);
  if (pathname === '/failure.sf2') return new Response('', { status: 503 });
  const filename = path.resolve('public', `.${pathname}`);
  assert(filename.startsWith(path.resolve('public/music') + path.sep));
  return new Response(await fs.readFile(filename));
};
let checks = 0;
let job = 0;
const note = (id, preset = harmonica, options = {}) => ({ id, trackId: 'track', takeId: 'take',
  preset: { id: preset.id, version: preset.version }, gain: 0.7, pitch: 60, velocity: 96,
  start: 0, duration: 0.3, sourceOffset: 0, ...options });
const render = (events, options = {}) => renderer.render({ type: 'render', jobId: `job-${++job}`,
  events, presets: sfPresets, duration: 13, sampleRate: rate, baseUrl: 'https://test.invalid/', ...options });
const rms = (samples, start, end) => {
  let sum = 0;
  const low = Math.floor(start * rate); const high = Math.floor(end * rate);
  for (let frame = low; frame < high; frame++) sum += samples[frame] ** 2;
  return Math.sqrt(sum / (high - low));
};
async function check(name, run) { await run(); checks++; console.log(`PASS ${name}`); }

try {
  await check('all four pinned SoundFonts export stereo with shared duration and audible release tails', async () => {
    for (const preset of sfPresets) {
      const duration = 1 + Math.max(8, preset.release * 8);
      const result = await render([note('single', preset, { start: 0.217, duration: 0.4 })], { duration });
      assert.equal(result.left.length, duration * rate);
      assert.equal(result.right.length, result.left.length);
      assert.equal(result.duration, duration);
      assert(result.peak > 0);
      assert(result.left.subarray(0, Math.round(0.217 * rate)).every(value => value === 0));
      assert(rms(result.left, 0.25, 0.55) > 0.001, `${preset.id}: recorded note audible`);
      assert(rms(result.left, 0.617, 0.63) > 0, `${preset.id}: native release survives note-off`);
      assert(result.left.subarray((duration - 1) * rate).every(value => value === 0), `${preset.id}: tail fully decays`);
    }
  });

  await check('cached banks survive repeated jobs and render bit-identical output', async () => {
    const events = [note('one', piano, { start: 0.12345, duration: 0.76543 })];
    const first = await render(events);
    const second = await render(events);
    assert.deepEqual(second.left, first.left);
    assert.deepEqual(second.right, first.right);
    for (const preset of sfPresets) assert.equal(fetchCounts.get(preset.url), 1, `${preset.id}: one fetch across passes`);
  });

  await check('same-pitch notes release independently and add linearly', async () => {
    const early = note('short', harmonica, { duration: 128 * 128 / rate });
    const late = note('long', harmonica, { duration: 128 * 256 / rate });
    const short = await render([early]);
    const long = await render([late]);
    const both = await render([early, late]);
    let maxError = 0;
    for (let frame = 0; frame < both.left.length; frame++) {
      maxError = Math.max(maxError, Math.abs(both.left[frame] - (short.left[frame] + long.left[frame])));
    }
    assert(maxError < 1e-6, `Unison addition mismatch ${maxError}`);
    assert(rms(both.left, 0.55, 0.7) > 0.001, 'long voice remains after short voice releases');
  });

  await check('captured gain and velocity are retained without normalization, SF2 offset matches retrigger behavior', async () => {
    const low = await render([note('gain', piano, { gain: 0.25 })]);
    const high = await render([note('gain', piano, { gain: 0.5 })]);
    for (let frame = 0; frame < low.left.length; frame++) assert(Math.abs(high.left[frame] - low.left[frame] * 2) < 1e-7);
    const softer = await render([note('gain', piano, { gain: 0.25, velocity: 50 })]);
    assert(softer.peak < low.peak, 'actual velocity affects sound');
    const offset = await render([note('gain', piano, { gain: 0.25, sourceOffset: 2 })]);
    assert.deepEqual(offset.left, low.left);
  });

  await check('bounded polyphony fails explicitly, timing/range validation and fetch errors are surfaced', async () => {
    await assert.rejects(render(Array.from({ length: 65 }, (_, index) => note(`poly-${index}`))), /simultaneous notes|sample voices/);
    await assert.rejects(render([note('range', piano, { pitch: 0 })]), /Invalid recorded note/);
    await assert.rejects(render([note('time')], { duration: 0.1 }), /Invalid recorded note/);
    await assert.rejects(render([note('tail')], { duration: 0.301 }), /tail is too short/);
    const missing = { ...harmonica, id: 'missing', url: '/failure.sf2' };
    await assert.rejects(render([note('network', missing)], { presets: [missing] }), /503/);
    const empty = await render([]);
    assert(empty.left.every(value => value === 0));
    assert.equal(empty.peak, 0);
  });
  await check('exact shared frame count survives non-round seconds without a double-ceil sample', async () => {
    let frameCount = 0;
    for (let candidate = 10000; candidate < 100000; candidate++) {
      if (Math.ceil((candidate / rate) * rate) > candidate) { frameCount = candidate; break; }
    }
    assert(frameCount > 0, 'fixture exposes floating-point double rounding');
    const duration = frameCount / rate;
    const explicit = await render([], { duration, frameCount });
    const inferred = await render([], { duration });
    assert.equal(explicit.left.length, frameCount);
    assert.equal(inferred.left.length, frameCount);
    await assert.rejects(render([], { duration, frameCount: frameCount + 1 }), /frame count/);
  });
  console.log(`${checks} SoundFont export checks passed.`);
} finally { globalThis.fetch = originalFetch; }
