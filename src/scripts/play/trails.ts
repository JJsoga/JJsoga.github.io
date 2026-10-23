import { PLAY_CONFIG } from './config';
import type { Point } from './types';

/** Decorative particles never enter the text/image scene or its physics. */
export interface TrailParticle extends Point {
  vx: number;
  vy: number;
  radius: number;
  age: number;
  lifetime: number;
}

export interface TrailState {
  particles: TrailParticle[];
  previous: Point | null;
  distanceCarry: number;
  sequence: number;
}

export const createTrailState = (): TrailState => ({
  particles: [], previous: null, distanceCarry: 0, sequence: 0,
});

/** Break continuity on leaving/re-entry, without removing a fading tail. */
export function breakTrail(state: TrailState) {
  state.previous = null;
  state.distanceCarry = 0;
}

export function clearTrail(state: TrailState) {
  state.particles.length = 0;
  state.sequence = 0;
  breakTrail(state);
}

export function emitTrail(
  state: TrailState, point: Point, elapsedSeconds: number,
  bounds: { width: number; height: number },
) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.y < 0 || point.x > bounds.width || point.y > bounds.height) {
    breakTrail(state);
    return;
  }
  const from = state.previous;
  state.previous = { ...point };
  if (!from) return;
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const config = PLAY_CONFIG.trail;
  const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0.008, elapsedSeconds) : 1 / 60;
  const speedRatio = Math.min(1, distance / seconds / config.speedLimit);
  const spacing = config.maxSpacing - speedRatio * (config.maxSpacing - config.minSpacing);
  const travelled = state.distanceCarry + distance;
  const count = Math.min(config.maxEmissionsPerMove, Math.floor(travelled / spacing));
  if (!count) {
    state.distanceCarry = travelled;
    return;
  }
  // Discard emission debt after long moves; a single event cannot cause a burst.
  state.distanceCarry = travelled % spacing;
  for (let index = 0; index < count; index++) {
    const fraction = (index + 1) / count;
    const angle = state.sequence++ * 2.399963229728653;
    // Recycling the oldest particle keeps the live pool strictly bounded.
    const particle = state.particles.length >= config.maxParticles
      ? state.particles.shift()!
      : {} as TrailParticle;
    Object.assign(particle, {
      x: from.x + dx * fraction,
      y: from.y + dy * fraction,
      vx: Math.cos(angle) * config.driftSpeed,
      vy: Math.sin(angle) * config.driftSpeed - config.driftSpeed * 0.2,
      radius: config.minRadius + speedRatio * (config.maxRadius - config.minRadius),
      age: 0,
      lifetime: config.lifetimeSeconds,
    });
    state.particles.push(particle);
  }
}

/** Age uses actual elapsed time, rather than the scene's stability timestep. */
export function stepTrail(state: TrailState, elapsedSeconds: number): boolean {
  const dt = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  let alive = 0;
  for (const particle of state.particles) {
    particle.age += dt;
    if (particle.age >= particle.lifetime) continue;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    state.particles[alive++] = particle;
  }
  state.particles.length = alive;
  return alive > 0;
}
