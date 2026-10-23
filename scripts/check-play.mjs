import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the real dependency-free behaviour modules; no browser or generated files.
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/scripts/play/behaviors.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const behavior = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const { stepScene, scatterScene, regroupScene, translateScene, throwScene, resetScene } = behavior;
const settings = { mode: 'push', strength: 1, force: 'repel', reducedMotion: false };
const inactive = { x: 0, y: 0, active: false };
const pointer = { x: 300, y: 200, active: true };
const fixture = () => ({
  width: 600,
  height: 400,
  scattered: false,
  grabbed: false,
  particles: Array.from({ length: 32 }, (_, index) => ({
    x: 195 + (index % 8) * 30,
    homeX: 195 + (index % 8) * 30,
    y: 155 + Math.floor(index / 8) * 30,
    homeY: 155 + Math.floor(index / 8) * 30,
    width: 30, height: 30, vx: 0, vy: 0,
  })),
});
const contained = scene => {
  for (const p of scene.particles) {
    assert.ok([p.x, p.y, p.vx, p.vy].every(Number.isFinite), 'state stays finite');
    assert.ok(p.x >= p.width / 2 && p.x <= scene.width - p.width / 2, 'horizontal bounds');
    assert.ok(p.y >= p.height / 2 && p.y <= scene.height - p.height / 2, 'vertical bounds');
    assert.ok(Math.hypot(p.vx, p.vy) <= 900.001, 'velocity limit');
  }
};
const atHome = scene => scene.particles.every(p => p.x === p.homeX && p.y === p.homeY && p.vx === 0 && p.vy === 0);
const settle = (scene, pointer, options) => {
  for (let frame = 0; frame < 1200; frame++) {
    const active = stepScene(scene, pointer, options, 1 / 60);
    contained(scene);
    if (!active) return frame + 1;
  }
  assert.fail('animation must stop requesting frames at rest');
};
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

check('push reacts, reaches a stationary target, and recovers exactly', () => {
  const scene = fixture();
  assert.equal(stepScene(scene, pointer, settings, 0), true);
  assert.ok(scene.particles.some(p => p.x !== p.homeX || p.y !== p.homeY));
  settle(scene, pointer, settings);
  assert.equal(stepScene(scene, pointer, settings, 1 / 60), false);
  settle(scene, inactive, settings);
  assert.ok(atHome(scene));
});

check('zero strength gives no push displacement', () => {
  const scene = fixture();
  assert.equal(stepScene(scene, pointer, { ...settings, strength: 0 }, 1 / 60), false);
  assert.ok(atHome(scene));
});

check('drag and throw preserve the rigid group, bounce, and stop', () => {
  const scene = fixture();
  const offsets = scene.particles.map(p => [p.x - scene.particles[0].x, p.y - scene.particles[0].y]);
  scene.grabbed = true;
  translateScene(scene, 10_000, -10_000);
  contained(scene);
  assert.equal(stepScene(scene, pointer, { ...settings, mode: 'grab' }, 1 / 60), false);
  throwScene(scene, 100_000, -100_000, 2);
  assert.equal(scene.grabbed, false);
  const before = { x: scene.particles[0].x, y: scene.particles[0].y };
  assert.equal(stepScene(scene, inactive, { ...settings, mode: 'grab' }, 1 / 60), true);
  assert.ok(scene.particles[0].vx < 0 && scene.particles[0].vy > 0, 'edge reverses throw direction');
  stepScene(scene, inactive, { ...settings, mode: 'grab' }, 1 / 60);
  assert.ok(scene.particles[0].x !== before.x || scene.particles[0].y !== before.y, 'motion continues after release');
  settle(scene, inactive, { ...settings, mode: 'grab' });
  scene.particles.forEach((p, i) => {
    assert.ok(Math.abs(p.x - scene.particles[0].x - offsets[i][0]) < 0.00001);
    assert.ok(Math.abs(p.y - scene.particles[0].y - offsets[i][1]) < 0.00001);
  });
});

check('scatter is repeatable, attracts and repels, then regroups exactly', () => {
  const scene = fixture();
  const twin = fixture();
  const particles = scene.particles;
  scatterScene(scene, 1, false);
  scatterScene(twin, 1, false);
  assert.deepEqual(scene, twin, 'scatter uses deterministic placement');
  assert.equal(scene.particles, particles, 'scatter reuses the bounded particle pool');
  contained(scene);
  const single = fixture();
  single.particles = [single.particles[0]];
  single.scattered = true;
  const localPointer = { x: single.particles[0].x - 30, y: single.particles[0].y, active: true };
  stepScene(single, localPointer, { ...settings, mode: 'scatter', force: 'repel' }, 1 / 60);
  assert.ok(single.particles[0].vx > 0, 'repel moves away');
  single.particles[0].vx = 0;
  stepScene(single, localPointer, { ...settings, mode: 'scatter', force: 'attract' }, 1 / 60);
  assert.ok(single.particles[0].vx < 0, 'attract moves toward pointer');
  settle(scene, pointer, { ...settings, mode: 'scatter', force: 'attract' });
  regroupScene(scene);
  settle(scene, inactive, { ...settings, mode: 'scatter' });
  assert.ok(atHome(scene));
});

check('reduced motion responds directly without a continuing animation', () => {
  const scene = fixture();
  const reduced = { ...settings, reducedMotion: true };
  assert.equal(stepScene(scene, pointer, reduced, 0), false);
  assert.ok(!atHome(scene));
  assert.equal(stepScene(scene, inactive, reduced, 0), false);
  assert.ok(atHome(scene));
  scatterScene(scene, 1, true);
  assert.equal(stepScene(scene, pointer, { ...reduced, mode: 'scatter' }, 0), false);
  assert.ok(scene.particles.every(p => p.vx === 0 && p.vy === 0));
  regroupScene(scene, true);
  assert.ok(atHome(scene));
  translateScene(scene, 15, 20);
  throwScene(scene, 500, 500, 1);
  const position = scene.particles.map(p => [p.x, p.y]);
  assert.equal(stepScene(scene, inactive, { ...reduced, mode: 'grab' }, 0), false);
  assert.deepEqual(scene.particles.map(p => [p.x, p.y]), position);
  assert.ok(scene.particles.every(p => p.vx === 0 && p.vy === 0));
});

check('long frames and repeated forces remain bounded; reset is complete', () => {
  const scene = fixture();
  scatterScene(scene, 2, false);
  for (let frame = 0; frame < 600; frame++) {
    stepScene(scene, { x: (frame * 31) % 600, y: (frame * 19) % 400, active: true },
      { ...settings, mode: 'scatter', force: frame % 2 ? 'attract' : 'repel', strength: 2 }, frame % 3 ? 1 / 60 : 80);
    contained(scene);
  }
  scene.grabbed = true;
  resetScene(scene);
  assert.ok(atHome(scene));
  assert.equal(scene.grabbed, false);
  assert.equal(scene.scattered, false);
  assert.equal(stepScene(scene, inactive, settings, 1 / 60), false);
});

console.log(`${checks} play behaviour checks passed.`);
