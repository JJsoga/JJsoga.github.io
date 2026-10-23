export type Mode = 'push' | 'grab' | 'scatter';
export type Sample = 'text' | 'card' | 'mark';
export type Force = 'repel' | 'attract';

export interface Point {
  x: number;
  y: number;
}

/** Coordinates locate the centre of a glyph or image tile, in CSS pixels. */
export interface Particle {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  glyph?: string;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
}

export interface Scene {
  particles: Particle[];
  width: number;
  height: number;
  scattered: boolean;
  grabbed: boolean;
}

export interface Pointer extends Point {
  active: boolean;
}

export interface BehaviorSettings {
  mode: Mode;
  strength: number;
  force: Force;
  reducedMotion: boolean;
}
