import { SoundBankLoader, SpessaLog, SpessaSynthProcessor, type BasicSoundBank } from 'spessasynth_core';
import { MUSIC_CONFIG, type PlaybackEvent, type Preset } from './types';
import type { SoundFontRenderMessage, SoundFontRenderProgress, SoundFontRenderRequest,
  SoundFontRenderResult } from './export-soundfont-types';

const RATE = 44100;
const BLOCK = 128;
const HEADROOM = 0.32;
const VOICE_CAP = MUSIC_CONFIG.maxVoices * 2;
const MAX_BANKS = 6;
const MAX_DURATION = MUSIC_CONFIG.maxDuration + 12;
const identity = (preset: { id: string; version: string }) => `${preset.id}@${preset.version}`;
type CachedBank = { url: string; promise: Promise<BasicSoundBank> };
type TimedAction = { frame: number; kind: 'on' | 'off'; event: PlaybackEvent; preset: Preset };
type OwnedNote = { channel: number; pitch: number; released: boolean };

/** A cache lives only as long as its export worker. Terminating the worker cancels all work. */
export class SoundFontRenderer {
  private banks = new Map<string, CachedBank>();

  async render(request: SoundFontRenderRequest,
    report: (progress: SoundFontRenderProgress) => void = () => {}): Promise<SoundFontRenderResult> {
    const { events, presets, frameCount } = validateRequest(request);
    const progress = (phase: SoundFontRenderProgress['phase'], value: number) =>
      report({ type: 'progress', jobId: request.jobId, phase, progress: value });
    progress('loading', 0);
    const used = [...new Map(events.map(event => [identity(event.preset), presets.get(identity(event.preset))!])).values()];
    const resources = new Map<string, { font: BasicSoundBank; bank: number }>();
    for (const [index, preset] of used.entries()) {
      const font = await this.loadBank(preset, request.baseUrl);
      if (!font.presets.some(candidate => candidate.program === preset.program
        && candidate.bankMSB === preset.bank && !candidate.isDrum)) {
        throw new Error(`The recorded patch is missing from ${preset.name}; export cannot substitute another sound.`);
      }
      // A fresh synth gets private bank numbers. Identity remains the original id/version.
      resources.set(identity(preset), { font, bank: index + 1 + preset.bank });
      progress('loading', (index + 1) / used.length);
    }
    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    if (!events.length) {
      progress('loading', 1);
      progress('rendering', 1);
      return { type: 'complete', jobId: request.jobId, left, right,
        sampleRate: RATE, duration: frameCount / RATE, peak: 0 };
    }

    SpessaLog.setLogLevel(false, false, false);
    const synth = new SpessaSynthProcessor(RATE, { maxBufferSize: BLOCK, effectsEnabled: false, eventsEnabled: false });
    await synth.processorInitialized;
    try {
      synth.setSystemParameter('voiceCap', VOICE_CAP);
      synth.setSystemParameter('autoAllocateVoices', false);
      synth.setSystemParameter('effectsEnabled', false);
      while (synth.midiChannels.length < VOICE_CAP) synth.createMIDIChannel();
      for (const channel of synth.midiChannels) channel.setDrums(false);
      for (const [key, resource] of resources) {
        const preset = presets.get(key)!;
        synth.soundBankManager.addSoundBank(resource.font, key, resource.bank - preset.bank);
      }

      const actions: TimedAction[] = events.flatMap(event => {
        const preset = presets.get(identity(event.preset))!;
        const start = Math.round(event.start * RATE);
        const end = Math.max(start + 1, Math.round((event.start + event.duration) * RATE));
        return [{ frame: start, kind: 'on' as const, event, preset },
          { frame: end, kind: 'off' as const, event, preset }];
      }).sort((a, b) => a.frame - b.frame || (a.kind === b.kind ? 0 : a.kind === 'off' ? -1 : 1));
      const notes = new Map<string, OwnedNote>();
      let cursor = 0;
      let actionIndex = 0;
      let lastProgress = -1;
      while (cursor < frameCount) {
        // A channel belongs to its note through the native SoundFont release tail.
        for (const [id, note] of notes) {
          if (note.released && synth.midiChannels[note.channel].voiceCount === 0) notes.delete(id);
        }
        // voiceCount is refreshed by process(), so count additions at the same frame separately.
        let addedLayers = 0;
        while (actions[actionIndex]?.frame <= cursor) {
          const action = actions[actionIndex++];
          if (action.kind === 'off') {
            const note = notes.get(action.event.id);
            if (note) {
              synth.noteOff(note.channel, note.pitch);
              note.released = true;
            }
            continue;
          }
          if (notes.size >= MUSIC_CONFIG.maxVoices) {
            throw new Error(`Export exceeds ${MUSIC_CONFIG.maxVoices} simultaneous notes including release tails. Reduce overlapping clips.`);
          }
          const occupied = new Set([...notes.values()].map(note => note.channel));
          const channelIndex = synth.midiChannels.findIndex((_, index) => !occupied.has(index));
          if (channelIndex < 0) throw new Error('Export ran out of independent note channels.');
          const lane = synth.midiChannels[channelIndex];
          lane.setSystemParameter('gain', action.event.gain * action.preset.defaultGain);
          const bank = resources.get(identity(action.preset))!.bank;
          synth.controllerChange(channelIndex, 0, bank);
          synth.controllerChange(channelIndex, 32, 0);
          synth.controllerChange(channelIndex, 7, 127);
          synth.controllerChange(channelIndex, 11, 127);
          synth.programChange(channelIndex, action.preset.program);
          const selected = lane.preset;
          if (!selected || lane.patch.bankMSB !== bank || lane.patch.program !== action.preset.program) {
            throw new Error(`Cannot select the recorded preset ${action.preset.name}.`);
          }
          const layers = selected.getVoiceParameters(action.event.pitch, action.event.velocity);
          if (!layers.length || layers.some(layer => layer.sample.getAudioData() === undefined)) {
            throw new Error(`No playable samples for MIDI ${action.event.pitch} in ${action.preset.name}.`);
          }
          if (synth.voiceCount + addedLayers + layers.length > VOICE_CAP) {
            throw new Error(`Export exceeds ${VOICE_CAP} SoundFont sample voices. Reduce overlapping clips; no notes were discarded.`);
          }
          addedLayers += layers.length;
          // As in live playback, SF2 sourceOffset restarts the attack. No mapping/key change is applied.
          synth.noteOn(channelIndex, action.event.pitch, action.event.velocity);
          notes.set(action.event.id, { channel: channelIndex, pitch: action.event.pitch, released: false });
        }
        // Never render across an event boundary: on/off timing is exact to the nearest sample.
        const next = Math.min(frameCount, cursor + BLOCK, actions[actionIndex]?.frame ?? frameCount);
        synth.process(left, right, cursor, next - cursor);
        cursor = next;
        const percent = Math.floor(cursor / frameCount * 100);
        if (percent !== lastProgress) {
          lastProgress = percent;
          progress('rendering', cursor / frameCount);
        }
      }
      if (actionIndex !== actions.length) throw new Error('The requested export ends before the last recorded note.');
      if (synth.voiceCount > 0) {
        throw new Error('The requested export tail is too short for the recorded SoundFont release.');
      }
      let peak = 0;
      for (let frame = 0; frame < frameCount; frame++) {
        left[frame] *= HEADROOM;
        right[frame] *= HEADROOM;
        if (!Number.isFinite(left[frame]) || !Number.isFinite(right[frame])) throw new Error('The instrument produced invalid audio.');
        peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
      }
      return { type: 'complete', jobId: request.jobId, left, right,
        sampleRate: RATE, duration: frameCount / RATE, peak };
    } finally {
      // The processor owns attached banks on destruction. Detach first so parsed
      // samples can safely be reused by later stems/passes in this same worker.
      for (const key of resources.keys()) synth.soundBankManager.deleteSoundBank(key);
      synth.destroySynthProcessor();
    }
  }

  private loadBank(preset: Preset, baseUrl?: string): Promise<BasicSoundBank> {
    const key = identity(preset);
    const url = new URL(preset.url, baseUrl ?? globalThis.location?.href).href;
    const existing = this.banks.get(key);
    if (existing) {
      if (existing.url !== url) throw new Error(`The asset URL changed for recorded preset ${key}.`);
      return existing.promise;
    }
    if (this.banks.size >= MAX_BANKS) throw new Error(`Export supports at most ${MAX_BANKS} instrument presets per worker.`);
    const promise = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Cannot download ${preset.name} (${response.status}). Try exporting again.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 64 * 1024 * 1024) throw new Error(`The instrument ${preset.name} exceeds the export resource limit.`);
      return SoundBankLoader.fromArrayBuffer(bytes);
    }).catch(error => {
      this.banks.delete(key);
      throw error;
    });
    this.banks.set(key, { url, promise });
    return promise;
  }
}

function validateRequest(request: SoundFontRenderRequest) {
  if (request.type !== 'render' || typeof request.jobId !== 'string' || !request.jobId) throw new Error('Invalid export job.');
  if (request.sampleRate !== RATE) throw new Error('SoundFont export requires 44100 Hz.');
  if (!Number.isFinite(request.duration) || request.duration <= 0 || request.duration > MAX_DURATION) throw new Error('Invalid export duration.');
  const frameCount = request.frameCount ?? Math.ceil(request.duration * RATE - 1e-7);
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > MAX_DURATION * RATE
    || (request.frameCount !== undefined && Math.abs(request.duration * RATE - frameCount) > 1e-5)) {
    throw new Error('The export frame count does not match its duration.');
  }
  if (!Array.isArray(request.events) || request.events.length > MUSIC_CONFIG.maxNotes) throw new Error('Too many export notes.');
  if (!Array.isArray(request.presets) || request.presets.length > MAX_BANKS) throw new Error('Too many export presets.');
  const presets = new Map(request.presets.map(preset => [identity(preset), preset]));
  const ids = new Set<string>();
  for (const event of request.events) {
    if (!event.id || ids.has(event.id)) throw new Error('Export note IDs must be unique.');
    ids.add(event.id);
    const preset = presets.get(identity(event.preset));
    if (!preset || preset.kind !== 'soundfont') throw new Error('The SoundFont renderer received an unknown or non-SoundFont preset.');
    if (!Number.isFinite(preset.defaultGain) || preset.defaultGain < 0 || preset.defaultGain > 16
      || !Number.isInteger(preset.bank) || preset.bank < 0 || preset.bank > 120
      || !Number.isInteger(preset.program) || preset.program < 0 || preset.program > 127) throw new Error('Invalid export instrument configuration.');
    if (![event.start, event.duration, event.sourceOffset, event.gain].every(Number.isFinite)
      || event.start < 0 || event.duration <= 0 || event.sourceOffset < 0 || event.gain < 0 || event.gain > 1
      || event.start + event.duration > request.duration || !Number.isInteger(event.pitch)
      || event.pitch < preset.range[0] || event.pitch > preset.range[1]
      || !Number.isInteger(event.velocity) || event.velocity < 1 || event.velocity > 127) throw new Error('Invalid recorded note in export.');
  }
  return { events: request.events, presets, frameCount };
}

// The exported class also permits deterministic Node validation without a browser.
if (typeof document === 'undefined' && typeof globalThis.postMessage === 'function') {
  const worker = globalThis as unknown as {
    onmessage: ((event: MessageEvent<SoundFontRenderRequest>) => void) | null;
    postMessage(message: SoundFontRenderMessage, transfer?: ArrayBuffer[]): void;
  };
  const renderer = new SoundFontRenderer();
  let busy = false;
  worker.onmessage = async ({ data }) => {
    if (busy) {
      worker.postMessage({ type: 'error', jobId: data.jobId, message: 'This export worker is already rendering a job.' });
      return;
    }
    busy = true;
    try {
      const result = await renderer.render(data, progress => worker.postMessage(progress));
      worker.postMessage(result, [result.left.buffer as ArrayBuffer, result.right.buffer as ArrayBuffer]);
    } catch (error) {
      worker.postMessage({ type: 'error', jobId: data.jobId,
        message: error instanceof Error ? error.message : 'SoundFont export failed.' });
    } finally { busy = false; }
  };
}
