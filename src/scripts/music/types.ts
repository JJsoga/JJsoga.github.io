/** Performance data is independent of instrument files and either visual view. */
export type Instrument = 'piano' | 'harmonica' | 'guitar';
export type Shape = 'star' | 'triangle' | 'square';
export interface PresetRef { id: string; version: string; }
export interface Preset extends PresetRef {
  name: string;
  instrument: Instrument;
  kind: 'soundfont' | 'samples';
  url: string;
  program: number;
  bank: number;
  range: [number, number];
  defaultGain: number;
  attack: number;
  release: number;
  sustain: string;
  mapping: string;
  source: string;
  license: string;
  licenseUrl: string;
  bytes?: number;
}
export interface SampleZone {
  url: string; root: number; low: number; high: number;
  velocityLow?: number; velocityHigh?: number;
  loopStart?: number; loopEnd?: number; gain?: number;
}
export interface SampleManifest { samples: SampleZone[]; }
export type DecodedSample = SampleZone & { buffer: AudioBuffer };
export interface Note { id: string; pitch: number; start: number; duration: number; velocity: number; }
export interface Take { id: string; preset: PresetRef; gain: number; notes: Note[]; duration: number; }
export interface Clip { id: string; takeId: string; start: number; sourceStart: number; duration: number; }
export interface Track { id: string; name: string; instrument: Instrument; presetId: string; volume: number; clips: Clip[]; }
export interface Project { version: 1; tracks: Track[]; takes: Record<string, Take>; }
export interface PlaybackEvent {
  id: string; trackId: string; takeId: string; preset: PresetRef; gain: number;
  pitch: number; velocity: number; start: number; duration: number; sourceOffset: number;
}
export const MUSIC_CONFIG = {
  maxTracks: 8, maxClips: 256, maxDuration: 120, maxNotes: 2000, maxVoices: 64,
  velocity: 96, lookAhead: 0.12, schedulerInterval: 25,
  defaultVolume: 0.7, visualLookAhead: 6, visualFade: 0.45,
} as const;
