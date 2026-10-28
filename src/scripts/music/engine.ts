/// <reference types="vite/client" />
import { WorkletSynthesizer } from 'spessasynth_lib';
import workletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { MUSIC_CONFIG, type DecodedSample, type Preset, type SampleManifest } from './types';

type SampleResource = DecodedSample;
type LoadedPreset = { kind: 'soundfont'; bank: number } | { kind: 'samples'; zones: SampleResource[] };
type SamplePart = { source: AudioBufferSourceNode; envelope: GainNode; level: number };
type Voice = {
  id: string; pitch: number; preset: Preset; start: number; off: number;
  channel?: number; parts?: SamplePart[];
};
const CHANNEL_COUNT = MUSIC_CONFIG.maxVoices * 2;
const presetKey = (preset: Preset) => `${preset.id}@${preset.version}`;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** One audio clock, one SoundFont processor, and individually owned note instances. */
export class MusicEngine {
  private context?: AudioContext;
  private synth?: WorkletSynthesizer;
  private output?: GainNode;
  private analyser?: AnalyserNode;
  private meter = new Float32Array(256);
  private initialization?: Promise<void>;
  private destroyed = false;
  private abort = new AbortController();
  private loads = new Map<string, Promise<void>>();
  private loaded = new Map<string, LoadedPreset>();
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private voices = new Map<string, Voice>();
  private retiredUntil = Array<number>(CHANNEL_COUNT).fill(0);
  private nextBank = 1;
  // The library uses one acknowledgement slot for bank mutations: serialize them.
  private bankQueue: Promise<unknown> = Promise.resolve();

  constructor(context?: AudioContext) { this.context = context; }

  get ready() { return !this.destroyed && !!this.synth && this.context?.state === 'running'; }
  get currentTime() { return this.context?.currentTime ?? 0; }

  /** Read-only buffer reuse for offline export; never exposes live voices or nodes. */
  getCachedSamples(preset: Preset): readonly DecodedSample[] | undefined {
    const resource = this.loaded.get(presetKey(preset));
    return resource?.kind === 'samples' ? resource.zones : undefined;
  }

  /** Call directly from a user gesture; no context or instrument is created on page load. */
  async enable(): Promise<void> {
    if (this.destroyed) throw new Error('This music session has ended.');
    if (!this.context) this.context = new AudioContext({ latencyHint: 'interactive' });
    const context = this.context;
    // Resume before the first await, preserving the browser's user-activation grant.
    const resume = context.resume();
    if (!this.initialization) {
      this.initialization = this.initialize(context).catch((error) => {
        this.synth?.destroy();
        this.synth = undefined;
        this.initialization = undefined;
        throw error;
      });
    }
    await Promise.all([resume, this.initialization]);
    this.assertAlive();
  }

  private async initialize(context: AudioContext) {
    await context.audioWorklet.addModule(workletUrl);
    this.assertAlive();
    const synth = new WorkletSynthesizer(context, { eventsEnabled: false });
    this.synth = synth;
    await synth.isReady;
    this.assertAlive();
    synth.setLogLevel(false, true, false);
    synth.setSystemParameter('voiceCap', MUSIC_CONFIG.maxVoices * 2);
    synth.setSystemParameter('autoAllocateVoices', false);
    synth.setSystemParameter('effectsEnabled', false);
    // Each note has its own channel, so same-pitch presses never release one another.
    while (synth.channelCount < CHANNEL_COUNT) synth.addNewChannel();
    // In lib 4.3.14 addNewChannel updates its public mirror both immediately and
    // again on acknowledgement. This ordered snapshot is a setup barrier; retain
    // exactly the wrappers for channels confirmed by the audio processor.
    const snapshot = await synth.getSnapshot();
    this.assertAlive();
    synth.midiChannels.length = snapshot.midiChannels.length;
    for (const channel of synth.midiChannels) channel.setDrums(false);
    this.output = context.createGain();
    this.output.gain.value = 0.32; // Fixed headroom for layered tracks; velocity is unchanged.
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = this.meter.length;
    this.output.connect(this.analyser).connect(context.destination);
    synth.connect(this.output);
  }

  async loadPreset(preset: Preset): Promise<void> {
    this.assertAlive();
    if (!this.context || !this.synth) throw new Error('Enable audio before loading an instrument.');
    const key = presetKey(preset);
    if (this.loaded.has(key)) return;
    const existing = this.loads.get(key);
    if (existing) return existing;
    const promise = this.load(preset).catch((error) => {
      this.loads.delete(key); // A failed network request can be retried.
      throw error;
    });
    this.loads.set(key, promise);
    return promise;
  }

  private async load(preset: Preset) {
    const response = await this.fetch(preset.url);
    const key = presetKey(preset);
    if (preset.kind === 'soundfont') {
      const buffer = await response.arrayBuffer();
      this.assertAlive();
      const bank = this.nextBank++ + preset.bank;
      if (bank > 127) throw new Error('Too many SoundFont banks in this session.');
      const operation = this.bankQueue.then(async () => {
        this.assertAlive();
        const synth = this.synth!;
        await new Promise<void>((resolve, reject) => {
          const fail = (error: unknown) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(`Could not load ${preset.name}.`));
          };
          const abort = () => fail(new DOMException('Music session closed.', 'AbortError'));
          const cleanup = () => {
            synth.eventHandler.removeEvent('soundBankError', key);
            this.abort.signal.removeEventListener('abort', abort);
          };
          synth.eventHandler.addEvent('soundBankError', key, fail);
          this.abort.signal.addEventListener('abort', abort, { once: true });
          synth.soundBankManager.addSoundBank(buffer, key, bank - preset.bank).then(() => {
            cleanup();
            resolve();
          }, fail);
        });
        this.assertAlive();
        this.loaded.set(key, { kind: 'soundfont', bank });
      });
      this.bankQueue = operation.catch(() => undefined);
      await operation;
      return;
    }
    const manifest = await response.json() as SampleManifest;
    if (!Array.isArray(manifest.samples) || manifest.samples.length === 0 || manifest.samples.length > 256) {
      throw new Error(`Invalid sample map for ${preset.name}.`);
    }
    const zones: SampleResource[] = Array(manifest.samples.length);
    let index = 0;
    // Bounded concurrent downloads; only the selected instrument's manifest is loaded.
    await Promise.all(Array.from({ length: Math.min(4, zones.length) }, async () => {
      for (;;) {
        const position = index++;
        if (position >= zones.length) return;
        const zone = manifest.samples[position];
        if (![zone.root, zone.low, zone.high].every(Number.isFinite) || zone.low > zone.high) {
          throw new Error(`Invalid sample range in ${preset.name}.`);
        }
        const url = new URL(zone.url, new URL(preset.url, location.href)).href;
        const buffer = await this.loadBuffer(url);
        const hasLoop = zone.loopStart !== undefined || zone.loopEnd !== undefined;
        if (hasLoop && !(Number.isFinite(zone.loopStart) && Number.isFinite(zone.loopEnd)
          && zone.loopStart! >= 0 && zone.loopEnd! > zone.loopStart! && zone.loopEnd! <= buffer.duration + 0.001)) {
          throw new Error(`Invalid sustain loop in ${preset.name}.`);
        }
        zones[position] = { ...zone, buffer };
      }
    }));
    this.assertAlive();
    this.loaded.set(key, { kind: 'samples', zones });
  }

  private loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    const promise = this.fetch(url).then(response => response.arrayBuffer()).then(buffer => {
      this.assertAlive();
      return this.context!.decodeAudioData(buffer);
    }).catch(error => {
      this.buffers.delete(url);
      throw error;
    });
    this.buffers.set(url, promise);
    return promise;
  }

  private async fetch(url: string) {
    const response = await fetch(url, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`Instrument download failed (${response.status}). Try again.`);
    return response;
  }

  /** Pitches and gains are snapshots supplied by the performer/take, never global settings. */
  noteOn(id: string, preset: Preset, pitch: number, velocity: number, gain: number,
    when = this.currentTime, sourceOffset = 0): boolean {
    if (!this.ready || !Number.isInteger(pitch) || pitch < preset.range[0] || pitch > preset.range[1]) return false;
    if (![when, sourceOffset, velocity, gain].every(Number.isFinite)) return false;
    const resource = this.loaded.get(presetKey(preset));
    if (!resource || this.voices.has(id)) return false;
    this.collect();
    if (this.voices.size >= MUSIC_CONFIG.maxVoices) return false;
    const time = Math.max(this.currentTime, when);
    const voice: Voice = { id, pitch, preset, start: time, off: Infinity };
    const level = clamp(gain, 0, 1) * preset.defaultGain;
    const strength = clamp(Math.round(velocity), 1, 127);
    if (resource.kind === 'soundfont') {
      const occupied = new Set([...this.voices.values()].map(value => value.channel));
      const channel = this.retiredUntil.findIndex((until, number) => until <= this.currentTime && !occupied.has(number));
      if (channel < 0) return false;
      voice.channel = channel;
      const synth = this.synth!;
      const lane = synth.midiChannels[channel];
      lane.setSystemParameter('isMuted', false);
      lane.setSystemParameter('gain', level);
      synth.controllerChange(channel, 0, resource.bank);
      synth.controllerChange(channel, 32, 0);
      synth.controllerChange(channel, 7, 127);
      synth.controllerChange(channel, 11, 127);
      synth.programChange(channel, preset.program);
      // SoundFont note-on does not expose sample seeking. Mid-note seek/trim restarts
      // its attack; the editor preserves the original event and documents this limit.
      synth.noteOn(channel, pitch, strength, { time });
      this.retiredUntil[channel] = time + 0.03;
    } else {
      const zones = resource.zones.filter(zone => pitch >= zone.low && pitch <= zone.high
        && strength >= (zone.velocityLow ?? 1) && strength <= (zone.velocityHigh ?? 127));
      if (!zones.length) return false;
      voice.parts = [];
      for (const zone of zones.slice(0, 8)) {
        const source = this.context!.createBufferSource();
        const envelope = this.context!.createGain();
        const rate = 2 ** ((pitch - zone.root) / 12);
        source.buffer = zone.buffer;
        source.playbackRate.value = rate;
        let offset = Math.max(0, sourceOffset) * rate;
        if (zone.loopStart !== undefined && zone.loopEnd !== undefined) {
          source.loop = true;
          source.loopStart = zone.loopStart;
          source.loopEnd = zone.loopEnd;
          if (offset >= zone.loopEnd) offset = zone.loopStart + (offset - zone.loopStart) % (zone.loopEnd - zone.loopStart);
        } else if (offset >= zone.buffer.duration) continue;
        const target = level * (zone.gain ?? 1) * (strength / 127);
        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(target, time + Math.max(0.003, preset.attack));
        source.connect(envelope).connect(this.output!);
        const part = { source, envelope, level: target };
        voice.parts.push(part);
        source.onended = () => {
          source.disconnect();
          envelope.disconnect();
          voice.parts = voice.parts?.filter(item => item !== part);
          if (voice.parts?.length === 0 && this.voices.get(id) === voice) this.voices.delete(id);
        };
        source.start(time, offset);
      }
      if (!voice.parts.length) return false;
    }
    this.voices.set(id, voice);
    return true;
  }

  noteOff(id: string, when = this.currentTime): void {
    const voice = this.voices.get(id);
    if (!voice || !Number.isFinite(when)) return;
    const time = Math.max(this.currentTime, when);
    if (voice.off <= time) return;
    voice.off = time;
    if (voice.channel !== undefined) {
      if (time < voice.start) {
        this.synth?.midiChannels[voice.channel].setSystemParameter('isMuted', true);
        this.voices.delete(id);
        return;
      }
      this.synth?.noteOff(voice.channel, voice.pitch, { time });
      this.retiredUntil[voice.channel] = Math.max(this.retiredUntil[voice.channel], time + 0.03);
    } else {
      for (const part of voice.parts ?? []) {
        const held = part.level * clamp((time - voice.start) / Math.max(0.003, voice.preset.attack), 0, 1);
        part.envelope.gain.cancelScheduledValues(time);
        part.envelope.gain.setValueAtTime(held, time);
        part.envelope.gain.linearRampToValueAtTime(0, time + voice.preset.release);
        part.source.stop(time + voice.preset.release + 0.01);
      }
    }
  }

  /** Muted retired channels discard queued starts before they may be reused. */
  stopAll(): void {
    for (const voice of this.voices.values()) {
      if (voice.channel !== undefined) {
        this.synth?.midiChannels[voice.channel].setSystemParameter('isMuted', true);
        this.retiredUntil[voice.channel] = Math.max(this.retiredUntil[voice.channel], this.currentTime + 0.03);
      }
      for (const part of voice.parts ?? []) {
        part.source.onended = null;
        part.source.stop();
        part.source.disconnect();
        part.envelope.disconnect();
      }
    }
    this.synth?.stopAll(true);
    this.voices.clear();
  }

  private collect() {
    const now = this.currentTime;
    for (const [id, voice] of this.voices) {
      if (voice.channel === undefined || voice.off > now) continue;
      const silent = now > voice.off + 0.05 && this.synth?.midiChannels[voice.channel].voiceCount === 0;
      // Release tails retain their channel; a pathological bank cannot hold it forever.
      const expired = now > voice.off + Math.max(8, voice.preset.release * 8);
      if (!silent && !expired) continue;
      if (expired) this.synth?.midiChannels[voice.channel].setSystemParameter('isMuted', true);
      this.voices.delete(id);
    }
  }

  getLevel(): number {
    if (!this.analyser || !this.ready) return 0;
    this.analyser.getFloatTimeDomainData(this.meter);
    return Math.sqrt(this.meter.reduce((sum, value) => sum + value * value, 0) / this.meter.length);
  }

  getSnapshot() {
    this.collect();
    return {
      ready: this.ready, contextState: this.context?.state ?? 'not-created', currentTime: this.currentTime,
      loaded: [...this.loaded.keys()], loading: [...this.loads.keys()].filter(key => !this.loaded.has(key)),
      voices: [...this.voices.values()].map(voice => ({ id: voice.id, pitch: voice.pitch,
        preset: presetKey(voice.preset), start: voice.start, off: Number.isFinite(voice.off) ? voice.off : null,
        channel: voice.channel ?? null })),
      synthVoices: this.synth?.voiceCount ?? 0, channels: this.synth?.channelCount ?? 0,
    };
  }

  async suspend(): Promise<void> {
    this.stopAll();
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.stopAll();
    this.synth?.destroy();
    this.synth = undefined;
    this.output?.disconnect();
    this.analyser?.disconnect();
    this.loaded.clear();
    this.loads.clear();
    this.buffers.clear();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }

  private assertAlive() {
    if (this.destroyed) throw new DOMException('Music session closed.', 'AbortError');
  }
}
