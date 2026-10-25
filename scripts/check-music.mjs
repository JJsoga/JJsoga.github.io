import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function load(relative) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { KEY_ROWS, MAJOR_KEYS, noteForCode, noteName } = await load('../src/scripts/music/keyboard.ts');
const { createProject, addTrack, moveClip, trimClip, splitClip, flattenEvents, projectDuration, uid } = await load('../src/scripts/music/model.ts');
const { MUSIC_CONFIG } = await load('../src/scripts/music/types.ts');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function fixture() {
  return {
    version: 1,
    tracks: [{ id: 'piano', name: 'Piano', instrument: 'piano', presetId: 'gu-piano', volume: 0.7,
      clips: [{ id: 'clip', takeId: 'take', start: 3, sourceStart: 0, duration: 8 }] }],
    takes: { take: { id: 'take', preset: { id: 'gu-piano', version: '1' }, gain: 0.7, duration: 8,
      notes: [
        { id: 'long', pitch: 60, start: 1, duration: 6, velocity: 96 },
        { id: 'unison', pitch: 60, start: 2, duration: 1, velocity: 85 },
        { id: 'high', pitch: 76, start: 6, duration: 2, velocity: 96 },
      ] } },
  };
}

check('14 physical keys map to two major-scale octaves in all 12 keys', () => {
  assert.deepEqual(KEY_ROWS.map(row => row.map(key => key.letter).join('')), ['ASDFGHJ', 'QWERTYU']);
  assert.equal(new Set(MAJOR_KEYS.map(key => key.tonic)).size, 12);
  const intervals = [0, 2, 4, 5, 7, 9, 11];
  for (const key of MAJOR_KEYS) for (let octave = -2; octave <= 2; octave++) {
    for (const row of KEY_ROWS) for (const entry of row) {
      const expected = 60 + key.tonic + intervals[entry.degree] + 12 * (entry.octave + octave);
      assert.equal(noteForCode(entry.code, key.tonic, octave, false), expected);
      assert.equal(noteForCode(entry.code, key.tonic, octave, true), expected + 1);
    }
  }
  assert.equal(noteName(noteForCode('KeyA', 0, 0, false)), 'C4');
  assert.equal(noteName(noteForCode('KeyF', 5, 0, false), true), 'B♭4');
  assert.equal(noteName(noteForCode('KeyD', 2, 0, false)), 'F♯4');
  assert.equal(noteName(noteForCode('KeyD', 9, 0, false)), 'C♯5');
  assert.equal(noteForCode('Space', 0, 0, false), null);
  assert.equal(noteForCode('KeyA', 0, -6, false), null);
  assert.equal(noteForCode('KeyU', 11, 9, true), null);
});

check('keydown pitch snapshots preserve shifted notes and independent unison combinations', () => {
  const held = new Map();
  const keydown = (code, shift) => { if (!held.has(code)) held.set(code, noteForCode(code, 0, 0, shift)); };
  keydown('KeyD', true); // E raised to F.
  keydown('KeyF', false); // A second physical key produces that same F.
  assert.deepEqual([...held.values()], [65, 65]);
  keydown('KeyD', false); // Repeat / later modifier state cannot replace the captured pitch.
  assert.equal(held.get('KeyD'), 65);
  held.delete('KeyD');
  assert.equal(held.get('KeyF'), 65);
  held.clear();
  assert.equal(held.size, 0);
  for (const key of [-1, 12, NaN, Infinity, 1.5]) assert.throws(() => noteForCode('KeyA', key, 0, false), RangeError);
  assert.throws(() => noteForCode('KeyA', 0, 0.5, false), RangeError);
  for (const pitch of [-1, 128, NaN, 60.5]) assert.throws(() => noteName(pitch), RangeError);
});

check('projects add bounded instrument tracks immutably', () => {
  const initial = freeze(createProject());
  assert.equal(initial.version, 1);
  assert.equal(initial.tracks[0].instrument, 'piano');
  assert.equal(initial.tracks[0].presetId, 'gu-piano');
  assert.equal(initial.tracks[0].volume, 0.7);
  assert.equal(projectDuration(initial), 0);
  let project = addTrack(initial, 'harmonica');
  assert.equal(initial.tracks.length, 1);
  assert.equal(project.tracks[1].presetId, 'gu-harmonica');
  project = addTrack(project, 'guitar');
  assert.equal(project.tracks[2].presetId, 'gu-guitar');
  while (project.tracks.length < MUSIC_CONFIG.maxTracks) project = addTrack(project, 'piano');
  assert.throws(() => addTrack(project, 'piano'), RangeError);
  assert.equal(new Set(project.tracks.map(track => track.id)).size, MUSIC_CONFIG.maxTracks);
  assert.notEqual(uid('note'), uid('note'));
});

check('move and trim change clip windows without rewriting recorded pitch, timing or level', () => {
  const project = freeze(fixture());
  const original = project.tracks[0].clips[0];
  const before = JSON.stringify(project);
  const moved = moveClip(original, 10);
  assert.equal(moved.start, 10);
  assert.equal(original.start, 3);
  const trimmed = trimClip(moved, 2, 4, 8);
  assert.deepEqual({ start: trimmed.start, sourceStart: trimmed.sourceStart, duration: trimmed.duration },
    { start: 12, sourceStart: 2, duration: 4 });
  const edited = { ...project, tracks: [{ ...project.tracks[0], clips: [trimmed] }] };
  const events = flattenEvents(edited);
  assert.deepEqual(events.map(({ pitch, start, duration, sourceOffset, gain, velocity }) =>
    ({ pitch, start, duration, sourceOffset, gain, velocity })), [
    { pitch: 60, start: 12, duration: 4, sourceOffset: 1, gain: 0.7, velocity: 96 },
    { pitch: 60, start: 12, duration: 1, sourceOffset: 0, gain: 0.7, velocity: 85 },
  ]);
  assert.equal(JSON.stringify(project), before);
  assert.equal(projectDuration(edited), 16);
  const restored = trimClip(trimmed, 0, 8, 8);
  assert.equal(restored.start, moved.start);
});

check('split preserves crossing-note continuity; gaps and independent unisons retain separate voices', () => {
  const project = fixture();
  const baseline = flattenEvents(project);
  const clip = project.tracks[0].clips[0];
  const split = splitClip(clip, 7);
  assert.equal(split[0].duration, 4);
  assert.equal(split[1].sourceStart, 4);
  assert.notEqual(split[0].id, split[1].id);
  project.tracks[0].clips = split;
  const comparable = events => events.map(({ id, ...event }) => event);
  assert.deepEqual(comparable(flattenEvents(project)), comparable(baseline));
  project.tracks[0].clips = [split[0], ...splitClip(split[1], 9)];
  assert.deepEqual(comparable(flattenEvents(project)), comparable(baseline));
  project.tracks[0].clips[1] = moveClip(project.tracks[0].clips[1], 20);
  const separated = flattenEvents(project);
  assert.equal(separated.filter(event => event.pitch === 60).length, 4);
  assert.equal(separated.find(event => event.start === 20).sourceOffset, 3);
  assert.equal(new Set(separated.map(event => event.id)).size, separated.length);
});

check('takes preserve preset versions and recorded gain after current performance settings change', () => {
  const project = fixture();
  const baseline = flattenEvents(project);
  project.tracks[0].presetId = 'vcsl-piano';
  project.tracks[0].volume = 0.1;
  assert.deepEqual(flattenEvents(project), baseline);
  const other = { ...project.tracks[0], id: 'second', name: 'Second', instrument: 'harmonica',
    clips: [{ id: 'otherclip', takeId: 'other', start: 2, sourceStart: 0, duration: 8 }] };
  project.tracks.push(other);
  project.takes.other = { ...project.takes.take, id: 'other', gain: 0.4,
    preset: { id: 'vcsl-harmonica', version: 'release-2' } };
  const events = flattenEvents(project);
  assert.equal(events.length, 6);
  assert.equal(events[0].trackId, 'second');
  assert.deepEqual(events[0].preset, { id: 'vcsl-harmonica', version: 'release-2' });
  assert.equal(events[0].gain, 0.4);
  events[0].preset.version = 'accidental output mutation';
  assert.equal(project.takes.other.preset.version, 'release-2');
  project.tracks[0].clips = [];
  assert.equal(flattenEvents(project).length, 3);
});

check('invalid edit bounds and invalid recordings fail explicitly', () => {
  const clip = fixture().tracks[0].clips[0];
  for (const value of [-1, NaN, Infinity, 119]) assert.throws(() => moveClip(clip, value), RangeError);
  for (const value of [3, 11, -1, NaN]) assert.throws(() => splitClip(clip, value), RangeError);
  assert.throws(() => trimClip(clip, -1, 5, 8), RangeError);
  assert.throws(() => trimClip(clip, 0, 0, 8), RangeError);
  assert.throws(() => trimClip(clip, 4, 5, 8), RangeError);
  assert.throws(() => trimClip({ ...clip, start: 0, sourceStart: 2, duration: 4 }, 0, 6, 8), RangeError);
  for (const mutation of [
    project => { project.takes.take.notes[0].pitch = NaN; },
    project => { project.takes.take.notes[0].pitch = 60.1; },
    project => { project.takes.take.notes[0].velocity = 0; },
    project => { project.takes.take.notes[0].duration = -1; },
    project => { project.takes.take.notes[0].duration = 100; },
    project => { project.takes.take.notes[0].start = Infinity; },
    project => { project.takes.take.notes[1].id = 'long'; },
    project => { project.takes.take.preset.version = ''; },
    project => { project.takes.take.gain = 2; },
    project => { project.tracks[0].clips[0].takeId = 'absent'; },
  ]) {
    const project = fixture(); mutation(project);
    assert.throws(() => flattenEvents(project), RangeError);
  }
});

check('recorded-note and expanded-event counts stay bounded', () => {
  const project = fixture();
  project.takes.take.notes = Array.from({ length: MUSIC_CONFIG.maxNotes }, (_, i) =>
    ({ id: `note-${i}`, pitch: 60, start: 1, duration: 1, velocity: 96 }));
  assert.equal(flattenEvents(project).length, MUSIC_CONFIG.maxNotes);
  project.takes.take.notes.push({ id: 'overflow', pitch: 60, start: 1, duration: 1, velocity: 96 });
  assert.throws(() => flattenEvents(project), RangeError);
  project.takes.take.notes.pop();
  project.tracks[0].clips.push({ ...project.tracks[0].clips[0], id: 'duplicate', start: 20 });
  assert.throws(() => flattenEvents(project), RangeError);
});

check('clip count is bounded even when its source windows contain no notes', () => {
  const project = fixture();
  project.takes.take.notes = [];
  project.tracks[0].clips = Array.from({ length: MUSIC_CONFIG.maxClips }, (_, i) =>
    ({ id: `clip-${i}`, takeId: 'take', start: 0, sourceStart: 0, duration: 1 }));
  assert.equal(flattenEvents(project).length, 0);
  project.tracks[0].clips.push({ ...project.tracks[0].clips[0], id: 'overflow' });
  assert.throws(() => flattenEvents(project), RangeError);
});

console.log(`${checks} music model checks passed. Browser checks separately cover focus, note release, shared-clock scheduling and the editing controls.`);
