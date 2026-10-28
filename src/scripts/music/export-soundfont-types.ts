import type { PlaybackEvent, Preset } from './types';

/** `duration` includes the common arrangement tail, even when this stem is silent. */
export interface SoundFontRenderRequest {
  type: 'render';
  jobId: string;
  events: PlaybackEvent[];
  presets: Preset[];
  duration: number;
  /** Exact shared length from the export plan, avoiding floating-point re-rounding. */
  frameCount?: number;
  sampleRate: 44100;
  baseUrl?: string;
}

export interface SoundFontRenderProgress {
  type: 'progress';
  jobId: string;
  phase: 'loading' | 'rendering';
  progress: number;
}

export interface SoundFontRenderResult {
  type: 'complete';
  jobId: string;
  left: Float32Array;
  right: Float32Array;
  sampleRate: 44100;
  duration: number;
  peak: number;
}

export type SoundFontRenderMessage = SoundFontRenderProgress | SoundFontRenderResult
  | { type: 'error'; jobId: string; message: string };
