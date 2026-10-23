import { PLAY_CONFIG as C } from './config';
import type { BehaviorSettings, Particle, Point, Pointer, Scene } from './types';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const strengthOf = (value: number) => clamp(value, 0, 2);

function bounds(scene: Scene, particle: Particle) {
  const halfW = Math.min(particle.width / 2, scene.width / 2);
  const halfH = Math.min(particle.height / 2, scene.height / 2);
  return { minX: halfW, maxX: scene.width - halfW, minY: halfH, maxY: scene.height - halfH };
}

function contain(scene: Scene, particle: Particle, bounce = false) {
  const b = bounds(scene, particle);
  const x = clamp(particle.x, b.minX, b.maxX);
  const y = clamp(particle.y, b.minY, b.maxY);
  if (x !== particle.x) particle.vx = bounce ? -particle.vx * C.bounce : 0;
  if (y !== particle.y) particle.vy = bounce ? -particle.vy * C.bounce : 0;
  particle.x = x;
  particle.y = y;
}

function limitVelocity(particle: Particle) {
  const speed = Math.hypot(particle.vx, particle.vy);
  if (speed > C.maxSpeed) {
    particle.vx *= C.maxSpeed / speed;
    particle.vy *= C.maxSpeed / speed;
  }
}

function direction(x: number, y: number, index: number): Point {
  const distance = Math.hypot(x, y);
  if (distance > 0.001) return { x: x / distance, y: y / distance };
  // A stable direction also makes a pointer exactly over a letter predictable.
  const angle = index * 2.399963229728653;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function pushTarget(scene: Scene, particle: Particle, pointer: Pointer, strength: number, index: number): Point {
  let x = particle.homeX;
  let y = particle.homeY;
  if (pointer.active && strength > 0) {
    // Use the resting location so each glyph has one stable, reversible target.
    const dx = particle.homeX - pointer.x;
    const dy = particle.homeY - pointer.y;
    const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / C.interactionRadius);
    const unit = direction(dx, dy, index);
    const amount = C.maxPushOffset * strength * proximity * proximity;
    x += unit.x * amount;
    y += unit.y * amount;
  }
  const b = bounds(scene, particle);
  return { x: clamp(x, b.minX, b.maxX), y: clamp(y, b.minY, b.maxY) };
}

/** Move a rigid group without letting its visible edges leave the stage. */
export function translateScene(scene: Scene, dx: number, dy: number): void {
  if (!scene.particles.length) return;
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;
  for (const particle of scene.particles) {
    const b = bounds(scene, particle);
    minDx = Math.max(minDx, b.minX - particle.x);
    maxDx = Math.min(maxDx, b.maxX - particle.x);
    minDy = Math.max(minDy, b.minY - particle.y);
    maxDy = Math.min(maxDy, b.maxY - particle.y);
  }
  const moveX = minDx <= maxDx ? clamp(dx, minDx, maxDx) : 0;
  const moveY = minDy <= maxDy ? clamp(dy, minDy, maxDy) : 0;
  for (const particle of scene.particles) {
    particle.x += moveX;
    particle.y += moveY;
    particle.vx = 0;
    particle.vy = 0;
    contain(scene, particle);
  }
}

export function throwScene(scene: Scene, vx: number, vy: number, strength: number): void {
  scene.grabbed = false;
  const multiplier = strengthOf(strength);
  for (const particle of scene.particles) {
    particle.vx = clamp(vx * multiplier, -C.maxSpeed, C.maxSpeed);
    particle.vy = clamp(vy * multiplier, -C.maxSpeed, C.maxSpeed);
    limitVelocity(particle);
  }
}

export function resetScene(scene: Scene): void {
  scene.scattered = false;
  scene.grabbed = false;
  for (const particle of scene.particles) {
    particle.x = particle.homeX;
    particle.y = particle.homeY;
    particle.vx = 0;
    particle.vy = 0;
    contain(scene, particle);
  }
}

export function regroupScene(scene: Scene, immediate = false): void {
  scene.scattered = false;
  scene.grabbed = false;
  for (const particle of scene.particles) particle.vx = particle.vy = 0;
  if (immediate) resetScene(scene);
}

/** Deterministic placement avoids hidden randomness and repeated allocation. */
export function scatterScene(scene: Scene, strength: number, reducedMotion: boolean): void {
  scene.scattered = true;
  scene.grabbed = false;
  const spread = 0.7 + strengthOf(strength) * 0.3;
  scene.particles.forEach((particle, index) => {
    const angle = index * 2.399963229728653 + 0.6;
    const radius = (0.27 + ((index * 37) % 101) / 160) * spread;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    particle.x = scene.width / 2 + dx * scene.width * 0.46 * radius;
    particle.y = scene.height / 2 + dy * scene.height * 0.46 * radius;
    particle.vx = reducedMotion ? 0 : dx * 130 * spread;
    particle.vy = reducedMotion ? 0 : dy * 130 * spread;
    contain(scene, particle);
  });
}

function stepGroup(scene: Scene, dt: number): boolean {
  const first = scene.particles[0];
  if (!first) return false;
  const friction = Math.exp(-C.throwFriction * dt);
  let vx = first.vx * friction;
  let vy = first.vy * friction;
  if (Math.hypot(vx, vy) < C.settleSpeed) {
    for (const particle of scene.particles) particle.vx = particle.vy = 0;
    return false;
  }
  const beforeX = first.x;
  const beforeY = first.y;
  translateScene(scene, vx * dt, vy * dt);
  if (Math.abs(first.x - beforeX - vx * dt) > 0.001) vx *= -C.bounce;
  if (Math.abs(first.y - beforeY - vy * dt) > 0.001) vy *= -C.bounce;
  for (const particle of scene.particles) {
    particle.vx = vx;
    particle.vy = vy;
  }
  return true;
}

/** Returns false when at rest; callers can stop requesting animation frames. */
export function stepScene(scene: Scene, pointer: Pointer, settings: BehaviorSettings, dtSeconds: number): boolean {
  if (scene.grabbed || !scene.particles.length) return false;
  const strength = strengthOf(settings.strength);
  const dt = clamp(dtSeconds || 1 / 60, 1 / 240, C.maxDeltaSeconds);
  if (settings.mode === 'grab') {
    if (!settings.reducedMotion) return stepGroup(scene, dt);
    for (const particle of scene.particles) particle.vx = particle.vy = 0;
    return false;
  }

  let moving = false;
  scene.particles.forEach((particle, index) => {
    if (settings.mode !== 'scatter' || !scene.scattered) {
      const target = pushTarget(scene, particle,
        settings.mode === 'push' ? pointer : { x: 0, y: 0, active: false }, strength, index);
      if (settings.reducedMotion) {
        particle.x = target.x;
        particle.y = target.y;
        particle.vx = particle.vy = 0;
        return;
      }
      const ax = C.spring * (target.x - particle.x) - C.damping * particle.vx;
      const ay = C.spring * (target.y - particle.y) - C.damping * particle.vy;
      particle.vx += ax * dt;
      particle.vy += ay * dt;
      limitVelocity(particle);
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      contain(scene, particle);
      if (Math.hypot(target.x - particle.x, target.y - particle.y) < C.settleDistance &&
          Math.hypot(particle.vx, particle.vy) < C.settleSpeed) {
        particle.x = target.x;
        particle.y = target.y;
        particle.vx = particle.vy = 0;
      } else moving = true;
      return;
    }

    let ax = 0;
    let ay = 0;
    if (pointer.active && strength > 0) {
      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      const proximity = Math.max(0, 1 - distance / C.interactionRadius);
      const unit = direction(dx, dy, index);
      // Attraction fades at the pointer, avoiding a singularity and endless jitter.
      const force = settings.force === 'attract' ? -proximity * distance / C.interactionRadius : proximity * proximity;
      ax = unit.x * force * C.particleForce * strength;
      ay = unit.y * force * C.particleForce * strength;
    }
    if (settings.reducedMotion) {
      particle.x += ax * 0.007;
      particle.y += ay * 0.007;
      particle.vx = particle.vy = 0;
      contain(scene, particle);
      return;
    }
    const previousX = particle.x;
    const previousY = particle.y;
    const friction = Math.exp(-C.scatterFriction * dt);
    particle.vx = (particle.vx + ax * dt) * friction;
    particle.vy = (particle.vy + ay * dt) * friction;
    limitVelocity(particle);
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    contain(scene, particle, true);
    if (Math.hypot(particle.x - previousX, particle.y - previousY) > C.settleDistance / 2 ||
        Math.hypot(particle.vx, particle.vy) >= C.settleSpeed) moving = true;
    else particle.vx = particle.vy = 0;
  });
  return !settings.reducedMotion && moving;
}
