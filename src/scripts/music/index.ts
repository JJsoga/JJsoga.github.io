import { KEY_ROWS, MAJOR_KEYS, isTypingTarget, noteForCode, noteName } from './keyboard';
import { createProject, addTrack, flattenEvents, moveClip, trimClip, splitClip, projectDuration, uid } from './model';
import { PRESETS, presetById } from './presets';
import { drawVisual, renderTimeline, updateTimelinePosition } from './views';
import { MUSIC_CONFIG, type Clip, type Instrument, type Note, type PlaybackEvent, type Preset, type Shape, type Take } from './types';
import type { MusicEngine } from './engine';

type Held = { id: string; code: string; pitch: number; recordStart?: number };
type Recording = { trackId: string; start: number; preset: Preset; gain: number; notes: Note[] };
type Task = { kind: 'on' | 'off'; time: number; event: PlaybackEvent; id: string; offset: number };

export function createMusic(root: HTMLElement) {
  const find = <T extends HTMLElement>(name: string) => {
    const element = root.querySelector<T>(`[data-music-${name}]`);
    if (!element) throw new Error(`Missing music control: ${name}`);
    return element;
  };
  const controls = find<HTMLFieldSetElement>('controls'), status = find('status');
  const enableButton = find<HTMLButtonElement>('enable'), presetSelect = find<HTMLSelectElement>('preset');
  const volume = find<HTMLInputElement>('volume'), keySelect = find<HTMLSelectElement>('key');
  const seek = find<HTMLInputElement>('seek'), viewSelect = find<HTMLSelectElement>('view');
  const shapeSelect = find<HTMLSelectElement>('shapes'), sharp = find<HTMLInputElement>('sharp');
  const canvas = find<HTMLCanvasElement>('canvas'), timeline = find('timeline');
  const editor = find<HTMLFieldSetElement>('editor'), recordButton = find<HTMLButtonElement>('record');
  const abort = new AbortController(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const held = new Map<string, Held>();
  const noteButtons = new Map([...root.querySelectorAll<HTMLButtonElement>('[data-music-note]')].map(button => [button.dataset.musicNote!, button]));
  let project = createProject(), selectedTrackId = project.tracks[0].id, selectedClip: string | null = null;
  let engine: MusicEngine | undefined, initialized = false, destroyed = false, busy = false, operation = 0;
  let octave = 0, key = 0, state: 'stopped' | 'playing' | 'recording' = 'stopped';
  let position = 0, anchorTime = 0, anchorPosition = 0, recording: Recording | undefined;
  let events: PlaybackEvent[] = [], tasks: Task[] = [], taskIndex = 0, timer = 0, frame = 0;
  let session = 0, capacityNotice = false, restoreFrame = 0;
  const track = () => project.tracks.find(item => item.id === selectedTrackId)!;
  const currentPreset = () => presetById(track().presetId);
  const positionNow = () => state === 'stopped' ? position : Math.min(MUSIC_CONFIG.maxDuration, Math.max(anchorPosition, anchorPosition + (engine!.currentTime - anchorTime)));
  const announce = (message: string) => { if (!destroyed) status.textContent = message; };
  const on = (target: EventTarget, name: string, listener: EventListener) => target.addEventListener(name, listener, { signal: abort.signal });
  const selected = () => {
    for (const item of project.tracks) {
      const clip = item.clips.find(clip => clip.id === selectedClip);
      if (clip) return { track: item, clip, take: project.takes[clip.takeId] };
    }
    return null;
  };
  const updateTrack = (changes: Partial<ReturnType<typeof track>>) => {
    project = { ...project, tracks: project.tracks.map(item => item.id === selectedTrackId ? { ...item, ...changes } : item) };
  };
  const refreshKeys = () => {
    const preset = currentPreset(), flats = MAJOR_KEYS.find(item => item.tonic === key)?.flats;
    for (const [code, button] of noteButtons) {
      const pitch = noteForCode(code, key, octave, sharp.checked);
      button.querySelector('[data-music-note-label]')!.textContent = pitch === null ? '—' : noteName(pitch, flats);
      button.setAttribute('aria-label', `${code.replace('Key', '')}: ${pitch === null ? 'outside MIDI range' : noteName(pitch, flats)}`);
      button.disabled = !initialized || busy || pitch === null || pitch < preset.range[0] || pitch > preset.range[1];
      button.dataset.held = String([...held.values()].some(note => note.code === code));
    }
    find('octave').textContent = `Octave ${4 + octave}`;
    find<HTMLButtonElement>('octave-down').disabled = octave <= -2;
    find<HTMLButtonElement>('octave-up').disabled = octave >= 2;
  };
  const renderEditor = () => {
    const selection = selected(); editor.disabled = !selection || state !== 'stopped' || busy;
    find('clip-title').textContent = selection ? `${selection.track.name} · ${selection.take.preset.id} · original take unchanged` : 'Choose a recorded clip';
    if (!selection) return;
    find<HTMLInputElement>('clip-start').value = selection.clip.start.toFixed(3);
    find<HTMLInputElement>('clip-in').value = selection.clip.sourceStart.toFixed(3);
    find<HTMLInputElement>('clip-out').value = (selection.clip.sourceStart + selection.clip.duration).toFixed(3);
    const middle = selection.clip.start + selection.clip.duration / 2;
    find<HTMLInputElement>('clip-split').value = (position > selection.clip.start && position < selection.clip.start + selection.clip.duration ? position : middle).toFixed(3);
  };
  const refreshControls = () => {
    controls.disabled = !initialized || busy;
    enableButton.disabled = busy; enableButton.textContent = initialized ? 'Sound enabled' : engine ? 'Resume sound' : 'Enable sound';
    find<HTMLButtonElement>('add').disabled = state !== 'stopped' || project.tracks.length >= MUSIC_CONFIG.maxTracks;
    presetSelect.disabled = state !== 'stopped'; volume.disabled = state === 'recording';
    find<HTMLSelectElement>('add-instrument').disabled = state !== 'stopped';
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-music-track]')) button.disabled = state !== 'stopped';
    find<HTMLButtonElement>('play').disabled = state !== 'stopped' || !events.length;
    find<HTMLButtonElement>('pause').disabled = state === 'stopped';
    recordButton.disabled = busy || state === 'playing';
    recordButton.textContent = state === 'recording' ? '■ Finish take' : '● Record selected track';
    recordButton.dataset.recording = String(state === 'recording');
    seek.disabled = state === 'recording';
    refreshKeys(); renderEditor();
  };
  const renderProject = () => {
    events = flattenEvents(project);
    const list = find('tracks'); list.replaceChildren();
    for (const [index, item] of project.tracks.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.musicTrack = item.id;
      button.textContent = `${index + 1}. ${item.name} · ${item.clips.length} clips`;
      button.setAttribute('aria-pressed', String(item.id === selectedTrackId)); list.append(button);
    }
    presetSelect.replaceChildren();
    for (const preset of PRESETS.filter(item => item.instrument === track().instrument)) {
      const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name; presetSelect.append(option);
    }
    presetSelect.value = track().presetId; volume.value = String(track().volume);
    find('volume-label').textContent = `${Math.round(track().volume * 100)}%`;
    const preset = currentPreset();
    find('preset-info').textContent = `${preset.name} · ${noteName(preset.range[0])}–${noteName(preset.range[1])}. ${preset.sustain} Volume is captured when you record.`;
    renderTimeline(timeline, project, selectedClip); refreshControls(); paint();
  };
  const visualEvents = () => {
    if (!recording) return events;
    const notes = [...recording.notes, ...[...held.values()].filter(note => note.recordStart !== undefined).map(note => ({
      id: note.id, pitch: note.pitch, start: note.recordStart!, duration: Math.max(.001, positionNow() - recording!.start - note.recordStart!), velocity: MUSIC_CONFIG.velocity,
    }))];
    return [...events, ...notes.map(note => ({ ...note, start: note.start + recording!.start, trackId: recording!.trackId, takeId: 'recording',
      preset: { id: recording!.preset.id, version: recording!.preset.version }, gain: recording!.gain, sourceOffset: 0 }))];
  };
  function paint() {
    if (destroyed) return;
    const now = positionNow();
    find('time').textContent = `${now.toFixed(2)} s`; seek.value = String(now);
    updateTimelinePosition(timeline, project, now);
    if (viewSelect.value === 'visual') {
      const visibleEvents = visualEvents();
      drawVisual(canvas, project, visibleEvents, now, shapeSelect.value as Shape | 'mixed', reduced.matches);
      const active = visibleEvents.filter(event => event.start <= now && now < event.start + event.duration);
      find('visual-description').textContent = active.length ? `Playing: ${active.map(event => noteName(event.pitch)).join(', ')}.` : `${project.tracks.length} instrument lanes. No notes active at ${now.toFixed(1)} seconds.`;
    }
  }
  const animate = () => {
    frame = 0; paint();
    if (state !== 'stopped' && !destroyed) frame = requestAnimationFrame(animate);
  };
  const release = (token: string) => {
    const note = held.get(token); if (!note) return;
    engine?.noteOff(note.id);
    if (recording && note.recordStart !== undefined) {
      const end = Math.max(note.recordStart + .001, positionNow() - recording.start);
      recording.notes.push({ id: note.id, pitch: note.pitch, start: note.recordStart, duration: end - note.recordStart, velocity: MUSIC_CONFIG.velocity });
    }
    held.delete(token); refreshKeys();
  };
  const releaseAll = () => { for (const token of [...held.keys()]) release(token); };
  const press = (token: string, code: string, shifted: boolean) => {
    if (destroyed || busy || !initialized || !engine?.ready || held.has(token)) return;
    const preset = recording?.preset ?? currentPreset();
    const pitch = noteForCode(code, key, octave, shifted);
    if (pitch === null || pitch < preset.range[0] || pitch > preset.range[1]) { announce('That note is outside this preset’s range. Try another octave.'); return; }
    const storedCount = Object.values(project.takes).reduce((sum, take) => sum + take.notes.length, 0);
    if (recording && storedCount + recording.notes.length + held.size >= MUSIC_CONFIG.maxNotes) { announce('The 2,000-note recording limit is reached. Finish this take.'); return; }
    if (recording && positionNow() >= MUSIC_CONFIG.maxDuration - .01) return;
    const id = uid('note');
    if (!engine.noteOn(id, preset, pitch, MUSIC_CONFIG.velocity, recording?.gain ?? track().volume)) {
      announce('The voice limit is reached. Release a note before adding another.'); return;
    }
    held.set(token, { id, code, pitch, ...(recording ? { recordStart: Math.max(0, positionNow() - recording.start) } : {}) });
    refreshKeys();
  };
  const finishRecording = () => {
    if (!recording) return;
    const takeRecord = recording; releaseAll();
    const duration = Math.max(.001, positionNow() - takeRecord.start, ...takeRecord.notes.map(note => note.start + note.duration));
    recording = undefined;
    if (!takeRecord.notes.length) { announce('No notes were recorded. Try another take.'); return; }
    const take: Take = { id: uid('take'), preset: { id: takeRecord.preset.id, version: takeRecord.preset.version }, gain: takeRecord.gain,
      notes: takeRecord.notes.map(note => ({ ...note })), duration };
    const clip: Clip = { id: uid('clip'), takeId: take.id, start: takeRecord.start, sourceStart: 0, duration };
    project = { ...project, takes: { ...project.takes, [take.id]: take }, tracks: project.tracks.map(item => item.id === takeRecord.trackId ? { ...item, clips: [...item.clips, clip] } : item) };
    selectedClip = clip.id;
    announce(`Recorded ${take.notes.length} notes with ${takeRecord.preset.name}. Select the clip to arrange it, or rewind and add another track.`);
  };
  const halt = (rewind = false, message?: string) => {
    if (destroyed) return;
    ++operation; finishRecording(); releaseAll(); position = rewind ? 0 : positionNow(); state = 'stopped'; busy = false;
    clearInterval(timer); timer = 0; cancelAnimationFrame(frame); frame = 0; tasks = []; taskIndex = 0; engine?.stopAll();
    renderProject(); if (message) announce(message);
  };
  const schedule = () => {
    if (!engine || state === 'stopped' || destroyed) return;
    const horizon = engine.currentTime + MUSIC_CONFIG.lookAhead;
    while (taskIndex < tasks.length && anchorTime + tasks[taskIndex].time - anchorPosition <= horizon) {
      const task = tasks[taskIndex++], time = anchorTime + task.time - anchorPosition;
      if (task.kind === 'on') {
        const preset = presetById(task.event.preset.id);
        if (!engine.noteOn(task.id, preset, task.event.pitch, task.event.velocity, task.event.gain, time, task.offset) && !capacityNotice) {
          capacityNotice = true; announce('Some overlapping notes exceeded the 64-voice limit. Reduce overlapping clips.');
        }
      } else engine.noteOff(task.id, time);
    }
    if (state === 'recording' && positionNow() >= MUSIC_CONFIG.maxDuration - .005) halt(false, 'Reached the 120-second limit. Your take is saved in this tab.');
    else if (state === 'playing' && engine.currentTime >= anchorTime + projectDuration(project) - anchorPosition + 2) {
      halt(false, 'Playback finished.'); position = projectDuration(project); paint();
    }
  };
  const run = async (record: boolean) => {
    if (busy || !initialized || !engine || destroyed || state !== 'stopped') return;
    if (record && project.tracks.reduce((count, item) => count + item.clips.length, 0) >= MUSIC_CONFIG.maxClips) {
      announce('The 256-clip limit is reached. Delete a clip before recording another take.'); return;
    }
    releaseAll(); engine.stopAll();
    if (position >= MUSIC_CONFIG.maxDuration - .01 || (!record && position >= projectDuration(project))) position = 0;
    const version = ++operation; busy = true; refreshControls(); announce('Preparing instruments…');
    try {
      await engine.enable();
      const required = new Map<string, Preset>();
      if (record) required.set(currentPreset().id, currentPreset());
      for (const event of events) {
        const preset = presetById(event.preset.id);
        if (preset.version !== event.preset.version) throw new Error('A take requires an unavailable preset version. It has not been substituted.');
        if (event.start + event.duration > position) required.set(preset.id, preset);
      }
      await Promise.all([...required.values()].map(preset => engine!.loadPreset(preset)));
      if (destroyed || version !== operation) return;
      anchorPosition = position; anchorTime = engine.currentTime + .04; capacityNotice = false;
      const prefix = `play-${++session}`;
      tasks = events.filter(event => event.start + event.duration > position).flatMap(event => {
        const start = Math.max(position, event.start), id = `${prefix}:${event.id}`;
        return [{ kind: 'on' as const, time: start, event, id, offset: event.sourceOffset + start - event.start },
          { kind: 'off' as const, time: event.start + event.duration, event, id, offset: 0 }];
      }).sort((a, b) => a.time - b.time || (a.kind === 'off' ? -1 : 1));
      taskIndex = 0; state = record ? 'recording' : 'playing';
      if (record) recording = { trackId: selectedTrackId, start: position, preset: { ...currentPreset() }, gain: track().volume, notes: [] };
      schedule(); timer = window.setInterval(schedule, MUSIC_CONFIG.schedulerInterval);
      if (!frame) frame = requestAnimationFrame(animate);
      announce(record ? `Recording ${track().name}. Other clips accompany you. Press notes, then Finish take.` : 'Playing all tracks on one audio clock.');
      root.focus({ preventScroll: true });
    } catch (error) { announce(error instanceof Error ? error.message : 'Audio could not start. Please retry.'); }
    finally { if (!destroyed && version === operation) { busy = false; refreshControls(); } }
  };
  const loadSelection = async () => {
    if (!engine || destroyed) return;
    const version = ++operation; busy = true; refreshControls(); announce(`Loading ${currentPreset().name}…`);
    try {
      await engine.enable(); await engine.loadPreset(currentPreset());
      if (version !== operation || destroyed) return;
      initialized = true; announce(`${currentPreset().name} ready. Play the letter keys or note buttons.`);
    } catch (error) { if (!destroyed && version === operation) {
      initialized = false;
      announce(`${error instanceof Error ? error.message : 'Instrument could not load.'} Press Resume sound to retry.`);
    } }
    finally { if (!destroyed && version === operation) { busy = false; renderProject(); } }
  };
  on(enableButton, 'click', async () => {
    if (busy) return;
    if (!engine) {
      const version = ++operation; busy = true; refreshControls(); announce('Starting the audio engine…');
      let context: AudioContext | undefined;
      try {
        // Unlock audio directly in the click gesture, before the lazy module import.
        context = new AudioContext({ latencyHint: 'interactive' });
        const resumed = context.resume();
        const { MusicEngine } = await import('./engine');
        await resumed;
        if (destroyed || version !== operation) { await context.close(); return; }
        engine = new MusicEngine(context);
      } catch (error) { void context?.close(); busy = false; refreshControls(); announce(error instanceof Error ? error.message : 'Audio is unavailable in this browser.'); return; }
      busy = false;
    }
    await loadSelection(); if (!destroyed) root.focus({ preventScroll: true });
  });
  on(find('tracks'), 'click', async event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-music-track]');
    if (!button || state !== 'stopped' || busy) return;
    releaseAll(); selectedTrackId = button.dataset.musicTrack!; renderProject(); await loadSelection();
  });
  on(find('add'), 'click', async () => {
    if (state !== 'stopped' || busy) return;
    try { releaseAll(); project = addTrack(project, find<HTMLSelectElement>('add-instrument').value as Instrument);
      selectedTrackId = project.tracks.at(-1)!.id; renderProject(); await loadSelection(); }
    catch (error) { announce((error as Error).message); }
  });
  on(presetSelect, 'change', async () => { releaseAll(); updateTrack({ presetId: presetSelect.value }); renderProject(); await loadSelection(); });
  on(volume, 'input', () => { updateTrack({ volume: Number(volume.value) }); find('volume-label').textContent = `${Math.round(track().volume * 100)}%`; });
  on(keySelect, 'change', () => { key = Number(keySelect.value); refreshKeys(); });
  on(sharp, 'change', refreshKeys);
  on(find('octave-down'), 'click', () => { octave = Math.max(-2, octave - 1); refreshKeys(); });
  on(find('octave-up'), 'click', () => { octave = Math.min(2, octave + 1); refreshKeys(); });
  on(window, 'keydown', event => {
    const e = event as KeyboardEvent;
    if (!root.contains(document.activeElement) || isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (!KEY_ROWS.flat().some(key => key.code === e.code)) return;
    e.preventDefault(); if (!e.repeat) press(`key:${e.code}`, e.code, e.shiftKey);
  });
  on(window, 'keyup', event => {
    const code = (event as KeyboardEvent).code; release(`key:${code}`);
    for (const token of [...held.keys()]) if (token.startsWith(`button:${code}:`)) release(token);
  });
  for (const [code, button] of noteButtons) {
    on(button, 'pointerdown', event => {
      const e = event as PointerEvent; if (e.button !== 0) return; e.preventDefault();
      button.focus({ preventScroll: true }); button.setPointerCapture(e.pointerId); press(`pointer:${e.pointerId}`, code, e.shiftKey || sharp.checked);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on(button, name, event => release(`pointer:${(event as PointerEvent).pointerId}`));
    on(button, 'keydown', event => { const e = event as KeyboardEvent; if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) press(`button:${e.code}:${code}`, code, e.shiftKey || sharp.checked); } });
    on(button, 'keyup', event => { const e = event as KeyboardEvent; if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); release(`button:${e.code}:${code}`); } });
    on(button, 'blur', () => { release(`button:Space:${code}`); release(`button:Enter:${code}`); });
  }
  on(root, 'focusout', event => { const next = (event as FocusEvent).relatedTarget; if (!(next instanceof Node) || !root.contains(next)) releaseAll(); });
  on(window, 'blur', releaseAll);
  on(find('play'), 'click', () => { void run(false); });
  on(find('record'), 'click', () => { if (state === 'recording') halt(); else void run(true); });
  on(find('pause'), 'click', () => halt(false, 'Paused.'));
  on(find('stop'), 'click', () => halt(true, 'Stopped at the beginning.'));
  on(seek, 'input', () => { const target = Number(seek.value); const resume = state === 'playing'; halt(); position = target; paint(); if (resume) void run(false); });
  on(viewSelect, 'change', () => {
    find('timeline-view').hidden = viewSelect.value !== 'timeline'; find('visual-view').hidden = viewSelect.value !== 'visual';
    find('shapes-control').hidden = viewSelect.value !== 'visual'; paint();
  });
  on(shapeSelect, 'change', paint); on(reduced, 'change', paint);
  const observer = new ResizeObserver(paint); observer.observe(root);
  on(timeline, 'click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-music-clip]');
    if (!button) return; selectedClip = button.dataset.musicClip!; renderTimeline(timeline, project, selectedClip); renderEditor(); paint();
  });
  const edit = (action: 'move' | 'trim' | 'split' | 'delete') => {
    const selection = selected(); if (!selection || state !== 'stopped' || busy) return;
    try {
      let replacements: Clip[];
      if (action === 'move') replacements = [moveClip(selection.clip, Number(find<HTMLInputElement>('clip-start').value))];
      else if (action === 'trim') {
        const start = Number(find<HTMLInputElement>('clip-in').value), end = Number(find<HTMLInputElement>('clip-out').value);
        replacements = [trimClip(selection.clip, start, end - start, selection.take.duration)];
      } else if (action === 'split') replacements = splitClip(selection.clip, Number(find<HTMLInputElement>('clip-split').value));
      else replacements = [];
      const candidate = { ...project, tracks: project.tracks.map(item => item.id === selection.track.id
        ? { ...item, clips: item.clips.flatMap(clip => clip.id === selection.clip.id ? replacements : [clip]) } : item) };
      flattenEvents(candidate); project = candidate; if (!replacements.length) selectedClip = null;
      // Reclaim takes with no clips; retained takes and their original notes are never rewritten.
      const used = new Set(project.tracks.flatMap(item => item.clips.map(clip => clip.takeId)));
      project = { ...project, takes: Object.fromEntries(Object.entries(project.takes).filter(([id]) => used.has(id))) };
      renderProject(); announce(`Clip ${action === 'delete' ? 'deleted' : action === 'split' ? 'split' : action === 'trim' ? 'trimmed' : 'moved'}. Original note pitches, timing and volume are preserved.`);
    } catch (error) { announce((error as Error).message); }
  };
  for (const action of ['move', 'trim', 'split', 'delete'] as const) on(find(action), 'click', () => edit(action));
  on(document, 'visibilitychange', () => { if (document.hidden) {
    halt(false, 'Sound paused while the page was hidden. Choose Resume sound to continue.');
    initialized = false; refreshControls(); void engine?.suspend();
  } });
  const credits = find('credits'); credits.replaceChildren();
  for (const preset of PRESETS) {
    const paragraph = document.createElement('p'); paragraph.className = 'music-credits';
    const strong = document.createElement('strong'); strong.textContent = `${preset.name} · ${preset.version}`;
    const source = document.createElement('a'); source.href = preset.source; source.textContent = 'Source'; source.target = '_blank'; source.rel = 'noreferrer';
    const license = document.createElement('a'); license.href = preset.licenseUrl; license.textContent = preset.license; license.target = '_blank'; license.rel = 'noreferrer';
    paragraph.append(strong, document.createElement('br'), `${preset.mapping} ${preset.sustain} `, source, ' · ', license); credits.append(paragraph);
  }
  renderProject(); root.dataset.musicReady = 'true';
  const refresh = () => {
    if (destroyed || restoreFrame) return;
    // History may restore native controls after pageshow. Match labels and model
    // to the retained key; synchronize fresh track levels and view visibility.
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0; if (destroyed) return;
      const restoredKey = Number(keySelect.value);
      key = MAJOR_KEYS.some(item => item.tonic === restoredKey) ? restoredKey : 0;
      keySelect.value = String(key);
      find('timeline-view').hidden = viewSelect.value !== 'timeline';
      find('visual-view').hidden = viewSelect.value !== 'visual';
      find('shapes-control').hidden = viewSelect.value !== 'visual';
      renderProject();
    });
  };
  const api = {
    refresh,
    getSnapshot: () => ({ project: structuredClone(project), position: positionNow(), state, selectedTrackId, selectedClip, busy,
      held: [...held.values()].map(note => ({ ...note })), engine: engine ? { ...engine.getSnapshot(), level: engine.getLevel() } : null,
      scheduled: tasks.length - taskIndex, frameActive: frame !== 0, schedulerActive: timer !== 0 }),
    destroy() {
      if (destroyed) return; halt(); destroyed = true; ++operation;
      cancelAnimationFrame(restoreFrame); restoreFrame = 0;
      abort.abort(); observer.disconnect(); controls.disabled = true; delete root.dataset.musicReady;
      void engine?.destroy();
    },
  };
  (root as HTMLElement & { musicStudio?: typeof api }).musicStudio = api;
  refresh();
  return api;
}

const instances = new Map<HTMLElement, ReturnType<typeof createMusic>>();
export function mountMusic() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-music]')) {
    const existing = instances.get(root); if (existing) { existing.refresh(); continue; }
    try { instances.set(root, createMusic(root)); }
    catch { const status = root.querySelector('[data-music-status]'); if (status) status.textContent = 'The music component could not start. Reload to try again.'; }
  }
}
function unmountMusic() { for (const instance of instances.values()) instance.destroy(); instances.clear(); }
document.addEventListener('astro:before-swap', unmountMusic);
document.addEventListener('astro:page-load', mountMusic);
window.addEventListener('pagehide', unmountMusic);
window.addEventListener('pageshow', mountMusic);
