import type { Mode } from './types';

/** Shared limits keep the same behaviours reusable on another canvas. */
export const PLAY_CONFIG = Object.freeze({
  enabledModes: ['push', 'grab', 'scatter'] as readonly Mode[],
  maxParticles: 128,
  pixelRatio: 2,
  maxSpeed: 900,
  interactionRadius: 120,
  maxPushOffset: 66,
  spring: 120,
  damping: 22,
  particleForce: 2200,
  scatterFriction: 4.5,
  throwFriction: 2.5,
  bounce: 0.42,
  maxDeltaSeconds: 1 / 30,
  settleDistance: 0.08,
  settleSpeed: 1.2,
});
