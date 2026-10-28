import { createExportPlan, commonExportGain } from './export-format';
import type { DecodedSample, PlaybackEvent, Preset, Project, SampleManifest } from './types';

export type ExportMode = 'mix' | 'stems';
export interface ExportProgress { progress: number; message: string; }
export interface ExportResult {
  mix: Blob; stems?: Blob; duration: number; tracks: number; omittedTracks: number; gain: number;
}
interface ExportOptions {
  signal: AbortSignal;
  onProgress: (value: ExportProgress) => void;
  cachedSamples?: (preset: Preset) => readonly DecodedSample[] | undefined;
}
const abortError = () => new DOMException('Audio export cancelled.', 'AbortError');
const check = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** One request at a time; termination owns cancellation, including fetch and synthesis. */
class WorkerTask {
  private count = 0;
  constructor(private worker: Worker, private signal: AbortSignal) {}
  run<T>(request: object, transfer: Transferable[] = [], progress?: (value: any) => void): Promise<T> {
    check(this.signal);
    const jobId = String(++this.count);
    return new Promise((resolve, reject) => {
      const clean = () => {
        this.worker.removeEventListener('message', message);
        this.worker.removeEventListener('error', failed);
        this.signal.removeEventListener('abort', cancelled);
      };
      const cancelled = () => { clean(); this.worker.terminate(); reject(abortError()); };
      const failed = (event: ErrorEvent) => { clean(); reject(new Error(event.message || 'Audio export worker failed.')); };
      const message = ({ data }: MessageEvent) => {
        if (data.jobId !== jobId) return;
        if (data.type === 'progress') { progress?.(data); return; }
        clean();
        if (data.type === 'error') reject(new Error(data.message)); else resolve(data as T);
      };
      this.worker.addEventListener('message', message);
      this.worker.addEventListener('error', failed);
      this.signal.addEventListener('abort', cancelled, { once: true });
      try { this.worker.postMessage({ ...request, jobId }, transfer); }
      catch (error) { clean(); reject(error); }
    });
  }
  dispose() { this.worker.terminate(); }
}

/** Inaudible, local rendering. Performance/take data is never modified. */
export async function exportMusic(project: Project, mode: ExportMode, options: ExportOptions): Promise<ExportResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal.addEventListener('abort', cancel, { once: true });
  if (options.signal.aborted) cancel();
  try { return await renderExport(project, mode, { ...options, signal: controller.signal }); }
  finally {
    // Also cancel sibling sample downloads when one concurrent download fails.
    controller.abort(); options.signal.removeEventListener('abort', cancel);
  }
}

async function renderExport(project: Project, mode: ExportMode, options: ExportOptions): Promise<ExportResult> {
  const { signal, onProgress } = options;
  const plan = createExportPlan(project);
  check(signal);
  let synth: WorkerTask | undefined, packer: WorkerTask | undefined;
  const samples = new Map<string, readonly DecodedSample[]>();
  const decoder = new OfflineAudioContext(2, 1, plan.sampleRate);
  const report = (progress: number, message: string) => { check(signal); onProgress({ progress, message }); };
  const fetchChecked = async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Instrument download failed (${response.status}). Please retry the export.`);
    return response;
  };
  const loadSamples = async (preset: Preset) => {
    const key = `${preset.id}@${preset.version}`;
    const cached = samples.get(key) ?? options.cachedSamples?.(preset);
    if (cached) { samples.set(key, cached); return cached; }
    const manifest = await (await fetchChecked(preset.url)).json() as SampleManifest;
    if (!Array.isArray(manifest.samples) || !manifest.samples.length || manifest.samples.length > 256) throw new Error('Invalid instrument sample map.');
    const zones: DecodedSample[] = Array(manifest.samples.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, zones.length) }, async () => {
      for (;;) {
        const index = next++; if (index >= zones.length) return;
        check(signal);
        const zone = manifest.samples[index];
        if (![zone.root, zone.low, zone.high, zone.gain ?? 1].every(Number.isFinite) || zone.low > zone.high || (zone.gain ?? 1) < 0) throw new Error('Invalid instrument sample mapping.');
        const url = new URL(zone.url, new URL(preset.url, location.href)).href;
        const buffer = await decoder.decodeAudioData(await (await fetchChecked(url)).arrayBuffer());
        check(signal);
        if ((zone.loopStart !== undefined || zone.loopEnd !== undefined)
          && !(Number.isFinite(zone.loopStart) && Number.isFinite(zone.loopEnd) && zone.loopStart! >= 0 && zone.loopEnd! > zone.loopStart! && zone.loopEnd! <= buffer.duration + .001)) throw new Error('Invalid instrument sustain loop.');
        zones[index] = { ...zone, buffer };
      }
    }));
    samples.set(key, zones); return zones;
  };
  const renderSamples = async (events: PlaybackEvent[]) => {
    const context = new OfflineAudioContext(2, plan.frameCount, plan.sampleRate);
    const nodes: AudioNode[] = [], sources: AudioBufferSourceNode[] = [];
    const disconnect = () => {
      for (const source of sources) { try { source.stop(0); } catch { /* Already finished. */ } }
      for (const node of nodes) node.disconnect();
    };
    signal.addEventListener('abort', disconnect, { once: true });
    try {
      for (const event of events) {
        check(signal);
        const preset = plan.presets.find(preset => preset.id === event.preset.id)!;
        const zones = await loadSamples(preset);
        const selected = zones.filter(zone => event.pitch >= zone.low && event.pitch <= zone.high
          && event.velocity >= (zone.velocityLow ?? 1) && event.velocity <= (zone.velocityHigh ?? 127));
        if (!selected.length || selected.length > 8) throw new Error('A recorded note has no supported sample mapping.');
        for (const zone of selected) {
          const rate = 2 ** ((event.pitch - zone.root) / 12);
          let offset = event.sourceOffset * rate;
          const source = context.createBufferSource(), envelope = context.createGain();
          source.buffer = zone.buffer; source.playbackRate.value = rate;
          if (zone.loopStart !== undefined && zone.loopEnd !== undefined) {
            source.loop = true; source.loopStart = zone.loopStart; source.loopEnd = zone.loopEnd;
            if (offset >= zone.loopEnd) offset = zone.loopStart + (offset - zone.loopStart) % (zone.loopEnd - zone.loopStart);
          } else if (offset >= zone.buffer.duration) continue;
          const level = .32 * event.gain * preset.defaultGain * (zone.gain ?? 1) * event.velocity / 127;
          const start = event.start, end = start + event.duration, attack = Math.max(.003, preset.attack);
          envelope.gain.setValueAtTime(0, start);
          envelope.gain.linearRampToValueAtTime(level, start + attack);
          envelope.gain.cancelScheduledValues(end);
          const heldLevel = level * Math.min(1, event.duration / attack);
          if (event.duration < attack) envelope.gain.linearRampToValueAtTime(heldLevel, end);
          else envelope.gain.setValueAtTime(heldLevel, end);
          envelope.gain.linearRampToValueAtTime(0, end + preset.release);
          source.connect(envelope).connect(context.destination);
          nodes.push(source, envelope); sources.push(source);
          source.start(start, offset); source.stop(end + preset.release + .01);
        }
      }
      check(signal);
      // Offline contexts never connect to speakers. On cancellation nodes disconnect;
      // any bounded native render already underway finishes and its result is discarded.
      const buffer = await context.startRendering();
      check(signal);
      return { left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
    } finally { signal.removeEventListener('abort', disconnect); disconnect(); }
  };
  const renderTrack = async (events: PlaybackEvent[], update: (fraction: number) => void) => {
    const fonts = events.filter(event => plan.presets.find(preset => preset.id === event.preset.id)!.kind === 'soundfont');
    const mapped = events.filter(event => plan.presets.find(preset => preset.id === event.preset.id)!.kind === 'samples');
    let result: { left: Float32Array; right: Float32Array };
    if (fonts.length) {
      synth ??= new WorkerTask(new Worker(new URL('./export-soundfont.worker.ts', import.meta.url), { type: 'module' }), signal);
      const response = await synth.run<typeof result>({ type: 'render', events: fonts, presets: plan.presets.filter(preset => preset.kind === 'soundfont'), duration: plan.duration, frameCount: plan.frameCount, sampleRate: plan.sampleRate, baseUrl: location.href }, [], value => update(value.phase === 'loading' ? value.progress * .2 : .2 + value.progress * .6));
      result = { left: response.left, right: response.right };
    } else result = { left: new Float32Array(plan.frameCount), right: new Float32Array(plan.frameCount) };
    check(signal);
    if (mapped.length) {
      const rendered = await renderSamples(mapped);
      await add(result, rendered);
    }
    update(1); return result;
  };
  const add = async (target: { left: Float32Array; right: Float32Array }, source: { left: Float32Array; right: Float32Array }) => {
    let peak = 0;
    for (let start = 0; start < plan.frameCount; start += 262144) {
      check(signal);
      const end = Math.min(start + 262144, plan.frameCount);
      for (let frame = start; frame < end; frame++) {
        const left = source.left[frame], right = source.right[frame];
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('The instrument renderer produced invalid audio.');
        peak = Math.max(peak, Math.abs(left), Math.abs(right));
        target.left[frame] += left; target.right[frame] += right;
      }
      await yieldTask();
    }
    return peak;
  };
  const encode = async (audio: { left: Float32Array; right: Float32Array }, gain: number) => {
    packer ??= new WorkerTask(new Worker(new URL('./export-pack.worker.ts', import.meta.url), { type: 'module' }), signal);
    const response = await packer.run<{ bytes: Uint8Array<ArrayBuffer> }>({ type: 'wav', left: audio.left, right: audio.right, gain }, [audio.left.buffer, audio.right.buffer]);
    check(signal); return response.bytes;
  };
  try {
    report(0, 'Preparing your arrangement…');
    const mix = { left: new Float32Array(plan.frameCount), right: new Float32Array(plan.frameCount) };
    let peak = 0;
    const passes = mode === 'stems' ? 2 : 1;
    for (const [index, track] of plan.tracks.entries()) {
      const base = index / plan.tracks.length / passes * .9;
      report(base, `Rendering ${track.name} (${index + 1}/${plan.tracks.length})…`);
      const rendered = await renderTrack(track.events, fraction => report(base + fraction / plan.tracks.length / passes * .9, `Rendering ${track.name}…`));
      peak = Math.max(peak, await add(mix, rendered));
    }
    for (let start = 0; start < plan.frameCount; start += 262144) {
      check(signal);
      for (let frame = start; frame < Math.min(start + 262144, plan.frameCount); frame++) peak = Math.max(peak, Math.abs(mix.left[frame]), Math.abs(mix.right[frame]));
      await yieldTask();
    }
    const gain = commonExportGain(peak);
    report(.9 / passes, 'Encoding the full mix…');
    const mixBlob = new Blob([await encode(mix, gain)], { type: 'audio/wav' });
    let stems: Blob | undefined;
    if (mode === 'stems') {
      const entries: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
      for (const [index, track] of plan.tracks.entries()) {
        const base = .45 + index / plan.tracks.length * .45;
        const rendered = await renderTrack(track.events, fraction => report(base + fraction / plan.tracks.length * .45, `Preparing track file ${index + 1}/${plan.tracks.length}…`));
        entries.push({ name: track.filename, data: await encode(rendered, gain) });
      }
      entries.push({ name: 'export-info.json', data: new TextEncoder().encode(JSON.stringify({
        format: 'PCM WAV', sampleRate: plan.sampleRate, channels: 2, bitDepth: 16,
        timelineStart: 0, duration: plan.duration, frameCount: plan.frameCount, arrangementDuration: plan.arrangementDuration,
        tailDuration: plan.tailDuration, commonOutputGain: gain, omittedEmptyTracks: plan.omittedTrackCount,
        tracks: plan.tracks.map(track => ({ filename: track.filename, name: track.name, trackId: track.trackId,
          presets: [...new Map(track.events.map(event => [event.preset.id, event.preset])).values()] })),
        notes: 'All files start at timeline zero. No individual track normalization. Sum all stems at unity gain to reconstruct the mix, within 16-bit rounding. SoundFont mid-note trims retrigger the attack, as in live playback.',
      }, null, 2)) });
      report(.94, 'Packing separate track files…');
      const response = await packer!.run<{ blob: Blob }>({ type: 'zip', entries }, entries.map(entry => entry.data.buffer));
      check(signal); stems = response.blob;
    }
    report(1, 'Audio files are ready.');
    return { mix: mixBlob, stems, gain, duration: plan.duration, tracks: plan.tracks.length, omittedTracks: plan.omittedTrackCount };
  } finally { synth?.dispose(); packer?.dispose(); samples.clear(); }
}
