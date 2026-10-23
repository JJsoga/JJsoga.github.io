import { generateLine, INITIAL_ROLLS, rollDice, WORD_BANKS } from './rules';
import type { DiceLocks, DiceRolls } from './rules';

/** DOM presentation is separate from the word banks and pure generation rules. */
export function createWordDice(root: HTMLElement) {
  const find = <T extends HTMLElement>(selector: string, within: HTMLElement = root) => {
    const element = within.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Word Dice element: ${selector}`);
    return element;
  };
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-word-die]'));
  if (cards.length !== WORD_BANKS.length) throw new Error('Word Dice requires four cards.');
  const controls = find<HTMLFieldSetElement>('[data-word-controls]');
  const rollAll = find<HTMLButtonElement>('[data-word-roll-all]');
  const copy = find<HTMLButtonElement>('[data-word-copy]');
  const result = find('[data-word-result]');
  const status = find('[data-word-status]');
  const lockStatus = find('[data-word-lock-status]');
  const manualCopy = find('[data-word-manual-copy]');
  const copyText = find<HTMLTextAreaElement>('[data-word-copy-text]');
  const locks = cards.map(card => find<HTMLInputElement>('[data-word-lock]', card));
  const reroll = cards.map(card => find<HTMLButtonElement>('[data-word-reroll]', card));
  const listeners = new AbortController();
  let destroyed = false;
  let copyVersion = 0;
  let restoreFrame = 0;
  // Own the state on the cards. Native form restoration can change checkbox
  // properties independently, including after pageshow; it is not our model.
  // BFCache retains these card attributes, while a fresh document starts at 1.
  let rolls = cards.map(card => Number(card.dataset.wordFace)) as DiceRolls;
  try { generateLine(rolls); } catch { rolls = [...INITIAL_ROLLS]; }
  let locked = cards.map(card => card.dataset.wordLocked === 'true') as DiceLocks;

  const announce = (message: string) => { status.textContent = message; };
  const invalidateCopy = () => {
    ++copyVersion;
    copy.disabled = false;
    copy.textContent = 'Copy line';
    manualCopy.hidden = true;
  };
  const render = () => {
    cards.forEach((card, index) => {
      card.dataset.wordFace = String(rolls[index]);
      card.dataset.wordLocked = String(locked[index]);
      find('[data-word-face]', card).textContent = String(rolls[index]);
      find('[data-word-phrase]', card).textContent = WORD_BANKS[index].phrases[rolls[index] - 1];
      find('[data-word-lock-label]', card).textContent = locked[index] ? 'Locked' : 'Lock';
      locks[index].checked = locked[index];
      reroll[index].disabled = locked[index];
    });
    const unlocked = locked.filter(value => !value).length;
    rollAll.disabled = unlocked === 0;
    lockStatus.textContent = unlocked === 0
      ? 'All four dice are locked. Unlock a die to roll again.'
      : `${unlocked} ${unlocked === 1 ? 'die is' : 'dice are'} unlocked. Locked dice keep their phrases.`;
    const sentence = generateLine(rolls);
    result.textContent = sentence;
    copyText.value = sentence;
  };
  const refresh = () => {
    if (destroyed || restoreFrame) return;
    // One frame after pageshow lets the browser finish restoring native form
    // controls, then aligns those controls with the cards and our owned model.
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0;
      if (!destroyed) render();
    });
  };
  const roll = (index?: number) => {
    if (destroyed || (index !== undefined && locked[index])) return;
    const count = index === undefined ? locked.filter(value => !value).length : 1;
    if (!count) return;
    invalidateCopy();
    rolls = rollDice(rolls, locked, Math.random, index);
    render();
    announce(index === undefined
      ? `Rolled ${count} unlocked ${count === 1 ? 'die' : 'dice'}. A die may land on the same face again.`
      : `${WORD_BANKS[index].label} die rolled ${rolls[index]}. A die may land on the same face again.`);
  };
  const on = (element: EventTarget, event: string, listener: EventListener) =>
    element.addEventListener(event, listener, { signal: listeners.signal });
  on(rollAll, 'click', () => roll());
  cards.forEach((card, index) => {
    on(reroll[index], 'click', () => roll(index));
    on(locks[index], 'change', () => {
      locked[index] = locks[index].checked;
      render();
      announce(`${WORD_BANKS[index].label} die ${locked[index] ? 'locked' : 'unlocked'}.${locked.every(Boolean) ? ' All four dice are locked. Unlock a die to roll again.' : ''}`);
    });
  });
  on(copy, 'click', async () => {
    const version = ++copyVersion;
    const sentence = generateLine(rolls);
    copy.disabled = true;
    copy.textContent = 'Copying…';
    manualCopy.hidden = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(sentence);
      if (destroyed || version !== copyVersion) return;
      announce('Generated line copied.');
    } catch {
      if (destroyed || version !== copyVersion) return;
      manualCopy.hidden = false;
      copyText.value = sentence;
      copyText.focus();
      copyText.select();
      announce('Automatic copying is unavailable. The generated line is selected below; copy it using your device’s copy command.');
    } finally {
      if (!destroyed && version === copyVersion) {
        copy.disabled = false;
        copy.textContent = 'Copy line';
      }
    }
  });
  controls.disabled = false;
  invalidateCopy();
  render();
  announce('');
  root.dataset.wordReady = 'true';
  refresh();
  return {
    refresh,
    getSnapshot: () => ({ rolls: [...rolls], locked: [...locked], sentence: generateLine(rolls) }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ++copyVersion;
      cancelAnimationFrame(restoreFrame);
      restoreFrame = 0;
      listeners.abort();
      controls.disabled = true;
      copy.disabled = false;
      copy.textContent = 'Copy line';
      manualCopy.hidden = true;
      delete root.dataset.wordReady;
    },
  };
}

const instances = new Map<HTMLElement, ReturnType<typeof createWordDice>>();
export function mountWordDice() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-word-dice]')) {
    const existing = instances.get(root);
    if (existing) { existing.refresh(); continue; }
    try { instances.set(root, createWordDice(root)); }
    catch {
      const status = root.querySelector('[data-word-status]');
      if (status) status.textContent = 'Word Dice could not start. The example line and face-to-phrase rules are still readable.';
    }
  }
}
function unmountWordDice() {
  for (const instance of instances.values()) instance.destroy();
  instances.clear();
}
document.addEventListener('astro:before-swap', unmountWordDice);
document.addEventListener('astro:page-load', mountWordDice);
window.addEventListener('pagehide', unmountWordDice);
window.addEventListener('pageshow', mountWordDice);
