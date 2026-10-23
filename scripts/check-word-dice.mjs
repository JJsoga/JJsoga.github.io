import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/scripts/word-dice/rules.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { WORD_BANKS, INITIAL_ROLLS, generateLine, rollDice } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`,
);
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }

check('every face maps to the advertised phrase in all 1,296 combinations', () => {
  assert.equal(WORD_BANKS.length, 4);
  for (const bank of WORD_BANKS) {
    assert.equal(bank.phrases.length, 6);
    assert.equal(new Set(bank.phrases).size, 6);
    assert.ok(bank.phrases.every(phrase => phrase.trim() === phrase && phrase.length > 0));
  }
  const lines = new Set();
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) {
      const faces = [a, b, c, d];
      const phrases = WORD_BANKS.map((bank, index) => bank.phrases[faces[index] - 1]);
      const assembled = phrases.join(' ');
      const line = generateLine(faces);
      assert.equal(line, assembled[0].toUpperCase() + assembled.slice(1) + '.');
      assert.ok(!line.includes('undefined') && !line.includes('  '));
      lines.add(line);
    }
  }
  assert.equal(lines.size, 1296);
  assert.equal(generateLine(INITIAL_ROLLS), 'Restless umbrellas rehearse the rain beside a sleeping moon.');
});

check('roll all preserves every locked face and leaves inputs unchanged', () => {
  for (let mask = 0; mask < 16; mask++) {
    const faces = Object.freeze([1, 2, 3, 4]);
    const locked = Object.freeze(faces.map((_, index) => Boolean(mask & (1 << index))));
    let calls = 0;
    const rolled = rollDice(faces, locked, () => { calls++; return 0.9999999999999999; });
    assert.deepEqual(rolled, faces.map((face, index) => locked[index] ? face : 6));
    assert.equal(calls, locked.filter(value => !value).length);
    assert.notEqual(rolled, faces);
  }
});

check('individual rerolls affect only the requested unlocked die', () => {
  for (let index = 0; index < 4; index++) {
    const faces = [2, 3, 4, 5];
    const locked = [false, false, false, false];
    assert.deepEqual(rollDice(faces, locked, () => 0, index), faces.map((face, position) => position === index ? 1 : face));
    locked[index] = true;
    assert.deepEqual(rollDice(faces, locked, () => { throw new Error('Locked dice must not consume random values'); }, index), faces);
  }
});

check('random intervals cover six faces and allow honest repeated results', () => {
  for (let face = 1; face <= 6; face++) {
    const value = (face - 1 + 0.5) / 6;
    assert.deepEqual(rollDice([face, face, face, face], [false, false, false, false], () => value), [face, face, face, face]);
  }
  assert.deepEqual(rollDice([2, 2, 2, 2], [false, false, false, false], () => 0), [1, 1, 1, 1]);
  for (const value of [-1, 1, NaN, Infinity]) {
    assert.throws(() => rollDice(INITIAL_ROLLS, [false, false, false, false], () => value), RangeError);
  }
});

check('invalid faces, lock arrays and indices fail clearly', () => {
  for (const faces of [[], [1, 2, 3], [0, 1, 1, 1], [7, 1, 1, 1], [1.5, 1, 1, 1], [NaN, 1, 1, 1]]) {
    assert.throws(() => generateLine(faces), RangeError);
  }
  assert.throws(() => rollDice(INITIAL_ROLLS, [false]), RangeError);
  assert.throws(() => rollDice(INITIAL_ROLLS, [0, 0, 0, 0]), RangeError);
  for (const index of [-1, 4, 0.5, NaN]) {
    assert.throws(() => rollDice(INITIAL_ROLLS, [false, false, false, false], Math.random, index), RangeError);
  }
});

console.log(`${checks} Word Dice checks passed. Grammar is curated; these checks verify mapping and generation rules, not literary quality.`);
