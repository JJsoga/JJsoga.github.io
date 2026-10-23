/** Every subject is plural; every verb phrase agrees with every subject.
 * Endings are adverbial phrases, so all 6^4 combinations use the same grammar.
 * Keep each bank at six entries: its position is the visible die face (1–6).
 */
export const WORD_BANKS = [
  {
    key: 'adjective', label: 'Adjective',
    phrases: ['restless', 'tiny', 'velvet', 'electric', 'invisible', 'patient'],
  },
  {
    key: 'subject', label: 'Plural subject',
    phrases: ['umbrellas', 'satellites', 'pigeons', 'teacups', 'shadows', 'robots'],
  },
  {
    key: 'verb', label: 'Verb phrase',
    phrases: ['rehearse the rain', 'borrow tomorrow', 'collect quiet', 'trade small miracles', 'untangle the wind', 'hum unfinished maps'],
  },
  {
    key: 'ending', label: 'Ending',
    phrases: ['beside a sleeping moon', 'before breakfast', 'in the margins of Tuesday', 'under an upside-down sky', 'between one heartbeat and the next', 'for absolutely no reason'],
  },
] as const;

export type DiceRolls = [number, number, number, number];
export type DiceLocks = [boolean, boolean, boolean, boolean];
export const INITIAL_ROLLS: Readonly<DiceRolls> = [1, 1, 1, 1];

function validateRolls(rolls: readonly number[]): asserts rolls is DiceRolls {
  if (rolls.length !== WORD_BANKS.length || rolls.some(face => !Number.isInteger(face) || face < 1 || face > 6)) {
    throw new RangeError('Word Dice needs four integer faces from 1 through 6.');
  }
}

export function generateLine(rolls: readonly number[]): string {
  validateRolls(rolls);
  const line = WORD_BANKS.map((slot, index) => slot.phrases[rolls[index] - 1]).join(' ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/** Random values must be finite and in [0, 1), as with Math.random.
 * Repeat faces are intentional: rerolling does not guarantee a different line.
 * The optional index rerolls only that die, respecting the same lock rule.
 */
export function rollDice(
  rolls: readonly number[], locked: readonly boolean[],
  random: () => number = Math.random, index?: number,
): DiceRolls {
  validateRolls(rolls);
  if (locked.length !== WORD_BANKS.length || locked.some(value => typeof value !== 'boolean')) {
    throw new RangeError('Word Dice needs four lock states.');
  }
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= WORD_BANKS.length)) {
    throw new RangeError('The die index must be from 0 through 3.');
  }
  return rolls.map((face, position) => {
    if (locked[position] || (index !== undefined && index !== position)) return face;
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('The random source must return a number in [0, 1).');
    }
    return Math.floor(value * 6) + 1;
  }) as DiceRolls;
}
