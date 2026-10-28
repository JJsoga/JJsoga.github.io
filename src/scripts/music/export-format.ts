import { flattenEvents, projectDuration } from './model';
import { presetById } from './presets';
import { MUSIC_CONFIG, type Instrument, type PlaybackEvent, type Preset, type Project } from './types';

/** Format and allocation limits are shared by planning, encoding and packaging. */
export const EXPORT_CONFIG = {
  sampleRate: 44100,
  channels: 2,
  bitDepth: 16,
  minimumTail: 8,
  maximumTail: 12,
  maxDuration: MUSIC_CONFIG.maxDuration + 12,
  maxFrames: Math.ceil((MUSIC_CONFIG.maxDuration + 12) * 44100),
  maxArchiveBytes: 200 * 1024 * 1024,
  maxArchiveEntries: MUSIC_CONFIG.maxTracks + 1, // Eight stems plus the manifest.
  attenuatedPeak: 0.98,
} as const;

export interface ExportTrackPlan {
  trackId: string;
  /** One-based export order, independent of empty tracks omitted from the archive. */
  trackIndex: number;
  name: string;
  instrument: Instrument;
  filename: string;
  events: PlaybackEvent[];
}

export interface ExportPlan {
  sampleRate: number;
  channels: 2;
  bitDepth: 16;
  timelineStart: 0;
  arrangementDuration: number;
  tailDuration: number;
  /** Sample-aligned end shared by the mix and every stem, including leading silence. */
  duration: number;
  frameCount: number;
  events: PlaybackEvent[];
  presets: Preset[];
  tracks: ExportTrackPlan[];
  omittedTrackCount: number;
}

const instrumentNames: Record<Instrument, string> = {
  piano: 'piano', harmonica: 'harmonica', guitar: 'nylon-guitar',
};

export function trackFilename(index: number, instrument: Instrument): string {
  if (!Number.isInteger(index) || index < 1 || index > MUSIC_CONFIG.maxTracks) throw new RangeError('Invalid export track number.');
  if (!Object.hasOwn(instrumentNames, instrument)) throw new RangeError('Unknown export instrument.');
  return `${String(index).padStart(2, '0')}-${instrumentNames[instrument]}.wav`;
}

/**
 * Plan from the recorded source data, never current performance settings. No
 * normalization, time shifting or new quantization is performed by this step.
 */
export function createExportPlan(project: Project): ExportPlan {
  const ids = new Set<string>();
  for (const track of project.tracks) {
    if (!track.id || ids.has(track.id)) throw new RangeError('Each export track needs a unique ID.');
    ids.add(track.id);
    if (!Object.hasOwn(instrumentNames, track.instrument)) throw new RangeError('Unknown export instrument.');
  }
  const flattened = flattenEvents(project);
  const audible = flattened.filter(event => event.gain > 0);
  if (audible.length === 0) throw new RangeError('Record at least one audible note before exporting. Empty and zero-volume tracks are omitted.');
  const used = new Map<string, Preset>();
  const tracks: ExportTrackPlan[] = [];
  for (const track of project.tracks) {
    const events = audible.filter(event => event.trackId === track.id);
    if (!events.length) continue;
    for (const event of events) {
      const preset = presetById(event.preset.id);
      if (preset.version !== event.preset.version) {
        throw new RangeError(`The take requires ${event.preset.id} version ${event.preset.version}; it has not been substituted.`);
      }
      if (preset.instrument !== track.instrument) throw new RangeError('A recorded preset does not match its track instrument.');
      if (!Number.isInteger(event.pitch) || event.pitch < preset.range[0] || event.pitch > preset.range[1]) {
        throw new RangeError(`Recorded pitch ${event.pitch} is outside ${preset.name}'s playable range.`);
      }
      if (!Number.isFinite(preset.release) || preset.release < 0 || preset.release * 8 > EXPORT_CONFIG.maximumTail) {
        throw new RangeError(`The release for ${preset.name} exceeds this export version's supported tail.`);
      }
      if (!Number.isFinite(preset.defaultGain) || preset.defaultGain <= 0) throw new RangeError('Invalid instrument playback gain.');
      if (!used.has(preset.id)) used.set(preset.id, { ...preset, range: [...preset.range] });
    }
    const trackIndex = tracks.length + 1;
    tracks.push({ trackId: track.id, trackIndex, name: track.name, instrument: track.instrument,
      filename: trackFilename(trackIndex, track.instrument), events });
  }
  const arrangementDuration = Math.min(MUSIC_CONFIG.maxDuration, projectDuration(project));
  const presets = [...used.values()];
  const tailDuration = Math.max(EXPORT_CONFIG.minimumTail, ...presets.map(preset => preset.release * 8));
  const frameCount = Math.ceil((arrangementDuration + tailDuration) * EXPORT_CONFIG.sampleRate);
  if (frameCount <= 0 || frameCount > EXPORT_CONFIG.maxFrames) throw new RangeError('The arrangement is too long to export.');
  return { sampleRate: EXPORT_CONFIG.sampleRate, channels: EXPORT_CONFIG.channels, bitDepth: EXPORT_CONFIG.bitDepth,
    timelineStart: 0, arrangementDuration, tailDuration, duration: frameCount / EXPORT_CONFIG.sampleRate,
    frameCount, events: audible, presets, tracks, omittedTrackCount: project.tracks.length - tracks.length };
}

function checkChannels(left: Float32Array, right: Float32Array): number {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length
    || left.length === 0 || left.length > EXPORT_CONFIG.maxFrames) {
    throw new RangeError('Export requires equal, nonempty stereo Float32 channels within the duration limit.');
  }
  return left.length;
}

/** Raw peak and clipping count; this does not modify or independently level audio. */
export function measureStereoPeak(left: Float32Array, right: Float32Array): { peak: number; clippedSamples: number; frames: number } {
  const frames = checkChannels(left, right);
  let peak = 0, clippedSamples = 0;
  for (let i = 0; i < frames; i++) {
    const l = Math.abs(left[i]), r = Math.abs(right[i]);
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new RangeError('Rendered audio contains a nonfinite sample.');
    peak = Math.max(peak, l, r);
    if (l > 1) clippedSamples++;
    if (r > 1) clippedSamples++;
  }
  return { peak, clippedSamples, frames };
}

/** The caller measures the mix AND stems, then applies this single gain to all. */
export function commonExportGain(peak: number): number {
  if (!Number.isFinite(peak) || peak < 0) throw new RangeError('Export peak must be finite and nonnegative.');
  return peak > 1 ? EXPORT_CONFIG.attenuatedPeak / peak : 1;
}

function ascii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

/** Encode stereo 44.1-kHz 16-bit PCM. Only the supplied common gain is applied. */
export function encodeWav(left: Float32Array, right: Float32Array, gain = 1): Uint8Array<ArrayBuffer> {
  const frames = checkChannels(left, right);
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new RangeError('Export attenuation gain must be between zero and one.');
  const bytesPerFrame = EXPORT_CONFIG.channels * EXPORT_CONFIG.bitDepth / 8;
  const dataBytes = frames * bytesPerFrame;
  const result = new Uint8Array(44 + dataBytes);
  const view = new DataView(result.buffer);
  ascii(view, 0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, EXPORT_CONFIG.channels, true); view.setUint32(24, EXPORT_CONFIG.sampleRate, true);
  view.setUint32(28, EXPORT_CONFIG.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true); view.setUint16(34, EXPORT_CONFIG.bitDepth, true);
  ascii(view, 36, 'data'); view.setUint32(40, dataBytes, true);
  for (let i = 0; i < frames; i++) {
    const l = left[i], r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new RangeError('Rendered audio contains a nonfinite sample.');
    const lScaled = Math.min(1, Math.max(-1, l * gain));
    const rScaled = Math.min(1, Math.max(-1, r * gain));
    view.setInt16(44 + i * 4, Math.round(lScaled * (lScaled < 0 ? 32768 : 32767)), true);
    view.setInt16(46 + i * 4, Math.round(rScaled * (rScaled < 0 ? 32768 : 32767)), true);
  }
  return result;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array<ArrayBuffer>; }

function safeArchiveName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !name.includes('..') && !name.endsWith('.')
    && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
}

/**
 * A deterministic stored ZIP as Blob-ready parts. Audio payloads are retained by
 * reference, so packaging does not allocate a second full archive-sized buffer.
 * The caller must not mutate payloads before constructing its Blob.
 */
export function createStoredZipParts(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer>[] {
  if (!entries.length || entries.length > EXPORT_CONFIG.maxArchiveEntries) throw new RangeError('Invalid number of export archive entries.');
  const names = new Set<string>();
  const encoder = new TextEncoder();
  const files = entries.map(entry => {
    if (!safeArchiveName(entry.name) || names.has(entry.name.toLowerCase())) throw new RangeError('Archive filenames must be unique, safe plain filenames.');
    names.add(entry.name.toLowerCase());
    if (!(entry.data instanceof Uint8Array) || !(entry.data.buffer instanceof ArrayBuffer)
      || entry.data.byteLength > 44 + EXPORT_CONFIG.maxFrames * 4) {
      throw new RangeError('An export archive entry exceeds the resource limit.');
    }
    return { ...entry, encodedName: encoder.encode(entry.name) };
  });
  const dataSize = files.reduce((sum, file) => sum + 30 + file.encodedName.length + file.data.length, 0);
  const directorySize = files.reduce((sum, file) => sum + 46 + file.encodedName.length, 0);
  const totalSize = dataSize + directorySize + 22;
  if (totalSize > EXPORT_CONFIG.maxArchiveBytes) throw new RangeError('The export archive exceeds the 200 MiB limit.');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const directory = new Uint8Array(directorySize + 22), view = new DataView(directory.buffer);
  let offset = 0, directoryOffset = 0;
  for (const file of files) {
    const checksum = crc32(file.data), length = file.data.length, nameLength = file.encodedName.length;
    const headerOffset = offset;
    const header = new Uint8Array(30 + nameLength), local = new DataView(header.buffer);
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names; stored, with known sizes.
    local.setUint16(10, 0, true); local.setUint16(12, 33, true); // 1980-01-01, deterministic.
    local.setUint32(14, checksum, true); local.setUint32(18, length, true);
    local.setUint32(22, length, true); local.setUint16(26, nameLength, true);
    header.set(file.encodedName, 30);
    parts.push(header, file.data);
    offset += 30 + nameLength + length;
    const central = directoryOffset;
    view.setUint32(central, 0x02014b50, true); view.setUint16(central + 4, 20, true);
    view.setUint16(central + 6, 20, true); view.setUint16(central + 8, 0x0800, true);
    view.setUint16(central + 12, 0, true); view.setUint16(central + 14, 33, true);
    view.setUint32(central + 16, checksum, true); view.setUint32(central + 20, length, true);
    view.setUint32(central + 24, length, true); view.setUint16(central + 28, nameLength, true);
    view.setUint32(central + 42, headerOffset, true); directory.set(file.encodedName, central + 46);
    directoryOffset += 46 + nameLength;
  }
  view.setUint32(directoryOffset, 0x06054b50, true);
  view.setUint16(directoryOffset + 8, files.length, true); view.setUint16(directoryOffset + 10, files.length, true);
  view.setUint32(directoryOffset + 12, directorySize, true); view.setUint32(directoryOffset + 16, dataSize, true);
  parts.push(directory);
  return parts;
}

/** Convenience encoder for consumers that need a contiguous byte array. */
export function createStoredZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const parts = createStoredZipParts(entries);
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
