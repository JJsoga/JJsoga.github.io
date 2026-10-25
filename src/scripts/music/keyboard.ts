/** Physical English-keyboard positions; pitch is resolved once, on keydown. */
export interface PerformanceKey { code: string; letter: string; degree: number; octave: number; }

const makeRow = (letters: string, octave: number): PerformanceKey[] =>
  [...letters].map((letter, degree) => ({ code: `Key${letter}`, letter, degree, octave }));

export const KEY_ROWS: PerformanceKey[][] = [makeRow('ASDFGHJ', 0), makeRow('QWERTYU', 1)];
export const MAJOR_KEYS = [
  { name: 'C major', tonic: 0, flats: false },
  { name: 'D♭ major', tonic: 1, flats: true },
  { name: 'D major', tonic: 2, flats: false },
  { name: 'E♭ major', tonic: 3, flats: true },
  { name: 'E major', tonic: 4, flats: false },
  { name: 'F major', tonic: 5, flats: true },
  { name: 'G♭ major', tonic: 6, flats: true },
  { name: 'G major', tonic: 7, flats: false },
  { name: 'A♭ major', tonic: 8, flats: true },
  { name: 'A major', tonic: 9, flats: false },
  { name: 'B♭ major', tonic: 10, flats: true },
  { name: 'B major', tonic: 11, flats: false },
] as const;

const majorScale = [0, 2, 4, 5, 7, 9, 11] as const;
const byCode = new Map(KEY_ROWS.flat().map(key => [key.code, key]));
const sharps = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flats = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Return null for an unmapped key or a transposition outside MIDI's range. */
export function noteForCode(code: string, keySemitone: number, octaveShift: number, shift: boolean): number | null {
  if (!Number.isInteger(keySemitone) || keySemitone < 0 || keySemitone > 11) {
    throw new RangeError('The musical key must be an integer from 0 to 11.');
  }
  if (!Number.isInteger(octaveShift) || !Number.isFinite(octaveShift)) {
    throw new RangeError('The octave shift must be a finite integer.');
  }
  const key = byCode.get(code);
  if (!key) return null;
  const pitch = 60 + keySemitone + majorScale[key.degree] + 12 * (key.octave + octaveShift) + Number(shift);
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

/** Absolute pitch labels also work for stored notes after the musical key changes. */
export function noteName(pitch: number, preferFlats = false): string {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    throw new RangeError('A note pitch must be an integer from 0 to 127.');
  }
  return `${(preferFlats ? flats : sharps)[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** Native editing controls and editable descendants retain their normal keyboard use. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}
