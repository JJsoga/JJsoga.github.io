import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/scripts/play/trails.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { createTrailState, emitTrail, stepTrail, breakTrail, clearTrail } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);
const bounds = { width: 600, height: 400 };
const emitSweep = (state, count = 1) => {
  emitTrail(state, { x: 10, y: 100 }, 1 / 60, bounds);
  for (let index = 0; index < count; index++) {
    emitTrail(state, { x: index % 2 ? 10 : 590, y: 100 }, 1 / 60, bounds);
  }
};
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

check('high-speed input and continuous activity have strict allocation bounds', () => {
  const state = createTrailState();
  emitSweep(state);
  assert.ok(state.particles.length > 0 && state.particles.length <= 12);
  emitSweep(state, 10_000);
  assert.ok(state.particles.length <= 96);
  assert.ok(state.particles.every(p => Object.values(p).every(Number.isFinite)));
  assert.ok(state.particles.every(p => p.x >= 0 && p.x <= bounds.width && p.y >= 0 && p.y <= bounds.height));
  const slow = createTrailState();
  const fast = createTrailState();
  for (const state of [slow, fast]) emitTrail(state, { x: 100, y: 100 }, 0, bounds);
  emitTrail(slow, { x: 200, y: 100 }, 1, bounds);
  emitTrail(fast, { x: 200, y: 100 }, 0.001, bounds);
  assert.ok(fast.particles.length >= slow.particles.length);
  assert.ok(fast.particles[0].radius > slow.particles[0].radius);
  assert.ok(fast.particles.every(p => p.radius <= 3.2));
});

check('expiry stops work, including a delayed frame', () => {
  const state = createTrailState();
  assert.equal(stepTrail(state, 1 / 60), false);
  emitSweep(state);
  assert.equal(stepTrail(state, 0.2), true);
  assert.equal(stepTrail(state, 0.4), false);
  assert.equal(state.particles.length, 0);
  emitSweep(state);
  assert.equal(stepTrail(state, 10), false);
});

check('drift and age depend on elapsed seconds, not frame rate', () => {
  const slowFrames = createTrailState();
  const fastFrames = createTrailState();
  emitSweep(slowFrames);
  emitSweep(fastFrames);
  for (let index = 0; index < 6; index++) stepTrail(slowFrames, 1 / 30);
  for (let index = 0; index < 24; index++) stepTrail(fastFrames, 1 / 120);
  slowFrames.particles.forEach((particle, index) => {
    for (const property of ['x', 'y', 'age']) {
      assert.ok(Math.abs(particle[property] - fastFrames.particles[index][property]) < 1e-9);
    }
  });
});

check('leaving, entering, and stationary input cannot create phantom paths', () => {
  const state = createTrailState();
  emitTrail(state, { x: 100, y: 100 }, 0, bounds);
  emitTrail(state, { x: 100, y: 100 }, 1, bounds);
  assert.equal(state.particles.length, 0);
  emitTrail(state, { x: -20, y: 100 }, 1 / 60, bounds);
  emitTrail(state, { x: 590, y: 100 }, 1 / 60, bounds);
  assert.equal(state.particles.length, 0, 're-entry only anchors the next trail');
  emitTrail(state, { x: 550, y: 100 }, 1 / 60, bounds);
  assert.ok(state.particles.length > 0);
  const count = state.particles.length;
  breakTrail(state);
  emitTrail(state, { x: 10, y: 300 }, 1 / 60, bounds);
  assert.equal(state.particles.length, count);
});

check('clear restores an idle state and reuses the pool container', () => {
  const state = createTrailState();
  const pool = state.particles;
  emitSweep(state);
  clearTrail(state);
  assert.deepEqual(state, createTrailState());
  assert.equal(state.particles, pool);
  assert.equal(stepTrail(state, 1 / 60), false);
  emitTrail(state, { x: 590, y: 300 }, 1 / 60, bounds);
  assert.equal(state.particles.length, 0);
});

console.log(`${checks} trail checks passed.`);
