import { MUSIC_CONFIG, type Clip, type Instrument, type PlaybackEvent, type Project, type Track } from './types';

const EPSILON = 1e-7;
const instruments: Record<Instrument, { name: string; presetId: string }> = {
  piano: { name: 'Piano', presetId: 'gu-piano' },
  harmonica: { name: 'Harmonica', presetId: 'gu-harmonica' },
  guitar: { name: 'Nylon guitar', presetId: 'gu-guitar' },
};
let nextId = 0;

export function uid(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++nextId).toString(36)}`;
  return `${prefix}-${random}`;
}

function finite(value: number, label: string, min = 0, max: number = MUSIC_CONFIG.maxDuration): void {
  if (!Number.isFinite(value) || value < min || value > max + EPSILON) {
    throw new RangeError(`${label} must be between ${min} and ${max}.`);
  }
}

function positive(value: number, label: string): void {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
}

function validateClip(clip: Clip): void {
  finite(clip.start, 'Clip start');
  finite(clip.sourceStart, 'Clip source start');
  positive(clip.duration, 'Clip duration');
  finite(clip.start + clip.duration, 'Clip end');
  finite(clip.sourceStart + clip.duration, 'Clip source end');
}

function newTrack(instrument: Instrument): Track {
  const description = instruments[instrument];
  if (!description) throw new RangeError('Unknown instrument.');
  return { id: uid('track'), name: description.name, instrument, presetId: description.presetId,
    volume: MUSIC_CONFIG.defaultVolume, clips: [] };
}

export function createProject(): Project {
  return { version: 1, tracks: [newTrack('piano')], takes: {} };
}

export function addTrack(project: Project, instrument: Instrument): Project {
  if (project.tracks.length >= MUSIC_CONFIG.maxTracks) throw new RangeError(`A project supports at most ${MUSIC_CONFIG.maxTracks} tracks.`);
  return { ...project, tracks: [...project.tracks, newTrack(instrument)] };
}

export function projectDuration(project: Project): number {
  let duration = 0;
  for (const track of project.tracks) for (const clip of track.clips) {
    validateClip(clip);
    duration = Math.max(duration, clip.start + clip.duration);
  }
  return duration;
}

export function moveClip(clip: Clip, start: number): Clip {
  const moved = { ...clip, start };
  validateClip(moved);
  return moved;
}

/** Left trimming moves the boundary; retained notes keep their timeline position. */
export function trimClip(clip: Clip, sourceStart: number, duration: number, takeDuration: number): Clip {
  validateClip(clip);
  finite(takeDuration, 'Take duration');
  finite(sourceStart, 'Clip source start');
  positive(duration, 'Clip duration');
  if (sourceStart + duration > takeDuration + EPSILON) throw new RangeError('The trim extends beyond the recorded take.');
  const trimmed = { ...clip, start: clip.start + sourceStart - clip.sourceStart, sourceStart, duration };
  validateClip(trimmed);
  return trimmed;
}

export function splitClip(clip: Clip, positionSeconds: number): [Clip, Clip] {
  validateClip(clip);
  finite(positionSeconds, 'Split position');
  const offset = positionSeconds - clip.start;
  if (offset <= EPSILON || offset >= clip.duration - EPSILON) throw new RangeError('Split inside the selected clip.');
  return [
    { ...clip, duration: offset },
    { ...clip, id: uid('clip'), start: positionSeconds, sourceStart: clip.sourceStart + offset, duration: clip.duration - offset },
  ];
}

interface NotePortion extends PlaybackEvent { noteId: string; }

/**
 * Both playback views consume these same absolute events. Clips only reference a
 * window in an immutable take; performance settings never rewrite its pitches,
 * preset version, velocity or gain. Source offsets let the player resume decay
 * when a trim begins inside a note if the playback backend supports seeking.
 */
export function flattenEvents(project: Project): PlaybackEvent[] {
  if (project.version !== 1 || project.tracks.length > MUSIC_CONFIG.maxTracks) throw new RangeError('Unsupported project or too many tracks.');
  if (project.tracks.reduce((count, track) => count + track.clips.length, 0) > MUSIC_CONFIG.maxClips) {
    throw new RangeError(`A project supports at most ${MUSIC_CONFIG.maxClips} clips.`);
  }
  const portions: NotePortion[] = [];
  let noteCount = 0;
  const validatedTakes = new Set<string>();

  for (const track of project.tracks) {
    finite(track.volume, 'Track volume', 0, 1);
    for (const clip of track.clips) {
      validateClip(clip);
      const take = project.takes[clip.takeId];
      if (!take) throw new RangeError('A clip refers to a missing take.');
      if (!validatedTakes.has(clip.takeId)) {
        finite(take.duration, 'Take duration');
        finite(take.gain, 'Take gain', 0, 1);
        if (!take.preset.id || !take.preset.version) throw new RangeError('Every take needs a specific preset and version.');
        const noteIds = new Set<string>();
        for (const note of take.notes) {
          if (++noteCount > MUSIC_CONFIG.maxNotes) throw new RangeError(`A project supports at most ${MUSIC_CONFIG.maxNotes} recorded notes.`);
          if (!note.id || noteIds.has(note.id)) throw new RangeError('Recorded note IDs must be unique within a take.');
          noteIds.add(note.id);
          finite(note.pitch, 'Note pitch', 0, 127);
          finite(note.velocity, 'Note velocity', 1, 127);
          if (!Number.isInteger(note.pitch) || !Number.isInteger(note.velocity)) throw new RangeError('Pitch and velocity must be MIDI integers.');
          finite(note.start, 'Note start');
          positive(note.duration, 'Note duration');
          if (note.start + note.duration > take.duration + EPSILON) throw new RangeError('A note extends beyond its recorded take.');
        }
        validatedTakes.add(clip.takeId);
      }
      if (clip.sourceStart + clip.duration > take.duration + EPSILON) throw new RangeError('A clip extends beyond its recorded take.');
      const sourceEnd = clip.sourceStart + clip.duration;
      for (const note of take.notes) {
        const start = Math.max(note.start, clip.sourceStart);
        const end = Math.min(note.start + note.duration, sourceEnd);
        if (end - start <= EPSILON) continue;
        if (portions.length >= MUSIC_CONFIG.maxNotes * 2) throw new RangeError('Too many scheduled note portions.');
        portions.push({ id: `${track.id}:${clip.id}:${note.id}`, trackId: track.id, takeId: take.id,
          noteId: note.id, preset: { ...take.preset }, gain: take.gain, pitch: note.pitch,
          velocity: note.velocity, start: clip.start + start - clip.sourceStart,
          duration: end - start, sourceOffset: start - note.start });
      }
    }
  }

  // Only merge contiguous portions of the SAME original note. Unison notes have
  // separate IDs and voices. A gap or rearrangement still creates a new event.
  portions.sort((a, b) => a.trackId.localeCompare(b.trackId) || a.takeId.localeCompare(b.takeId)
    || a.noteId.localeCompare(b.noteId) || a.start - b.start || a.sourceOffset - b.sourceOffset);
  const merged: NotePortion[] = [];
  for (const event of portions) {
    const previous = merged[merged.length - 1];
    if (previous && previous.trackId === event.trackId && previous.takeId === event.takeId
      && previous.noteId === event.noteId && Math.abs(previous.start + previous.duration - event.start) < EPSILON
      && Math.abs(previous.sourceOffset + previous.duration - event.sourceOffset) < EPSILON) {
      previous.duration += event.duration;
    } else merged.push({ ...event });
  }
  if (merged.length > MUSIC_CONFIG.maxNotes) throw new RangeError(`A project supports at most ${MUSIC_CONFIG.maxNotes} scheduled notes.`);
  return merged.sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId))
    .map(({ noteId: _noteId, ...event }) => event);
}
