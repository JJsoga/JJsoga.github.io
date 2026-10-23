async (page) => {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(() => window.__playV2.getSnapshot());
  const dice = () => page.evaluate(() => window.__diceV2.getSnapshot());
  const canvas = page.locator('[data-play-canvas]');
  const trailToggle = page.locator('[data-play-trail]');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('http://localhost:4321/play/');
  await page.waitForSelector('[data-word-ready="true"]');
  await page.evaluate(async () => {
    const play = await import('/src/scripts/play/index.ts');
    const words = await import('/src/scripts/word-dice/index.ts');
    document.dispatchEvent(new Event('astro:before-swap'));
    window.__playV2 = play.createPlayground(document.querySelector('[data-playground]'));
    window.__diceV2 = words.createWordDice(document.querySelector('[data-word-dice]'));
    window.__v2Modules = { play, words };
  });
  const mode = async value => {
    await page.locator(`label:has([data-play-mode][value="${value}"])`).click();
    await canvas.scrollIntoViewIfNeeded();
  };
  const sweep = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 25, box.y + 35);
    await page.mouse.move(box.x + box.width - 25, box.y + 50, { steps: 18 });
    return box;
  };
  for (const value of ['push', 'grab', 'scatter']) {
    await mode(value);
    await sweep();
    const snapshot = await state();
    assert(snapshot.trailParticles.length > 0 && snapshot.trailParticles.length <= 96, `${value}: live trails bounded`);
    assert(snapshot.particles.length === 12, 'Trails cannot change the scene particle pool');
    assert(snapshot.trailParticles.every(p => p.age >= 0 && p.age < p.lifetime), 'All emitted particles must be alive');
  }
  await mode('grab');
  await sweep();
  await page.waitForFunction(() => {
    const s = window.__playV2.getSnapshot();
    return !s.running && s.trailParticles.length === 0;
  }, null, { timeout: 2000 });
  checks.push('trails in all three modes, separate capped pool, expiry and idle stopping');

  await trailToggle.focus();
  await page.keyboard.press('Space');
  assert(!(await state()).trailEnabled, 'Keyboard toggle disables trails');
  await sweep();
  assert((await state()).trailParticles.length === 0, 'Disabled trail cannot emit');
  await trailToggle.check();
  const bounds = await sweep();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width / 2 + 40, y: bounds.y + bounds.height / 2 + 10, id: 1 }] });
  assert((await state()).trailParticles.length > 0, 'Touch movement emits a trail');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert((await state()).trailParticles.length === 0, 'Touch cancellation clears trails');
  await touch.detach();
  await sweep();
  await page.locator('[data-play-reset]').click();
  assert((await state()).trailParticles.length === 0 && !(await state()).running, 'Reset clears trails and stops animation');
  checks.push('keyboard Trail toggle, native touch emission/cancellation, and reset');

  await sweep();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert(!(await state()).running && (await state()).trailParticles.length === 0, 'Hidden-page handler clears and pauses');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sweep();
  await page.locator('[data-word-result]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !window.__playV2.getSnapshot().running, null, { timeout: 2000 });
  assert((await state()).trailParticles.length === 0, 'Offscreen stage clears trail');
  await sweep();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__playV2.getSnapshot().reducedMotion);
  await sweep();
  assert(!(await state()).trailEnabled && (await state()).trailParticles.length === 0 && !(await state()).running, 'Reduced motion suppresses trail and RAF');
  assert(await trailToggle.isDisabled() && await page.locator('[data-play-trail-note]').isVisible(), 'Reduced-motion toggle state explained');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => window.__playV2.getSnapshot().trailEnabled);
  checks.push('visibility/offscreen pause and reduced-motion suppression/restoration');

  const locks = page.locator('[data-word-lock]');
  const rerolls = page.locator('[data-word-reroll]');
  const all = page.locator('[data-word-roll-all]');
  assert((await dice()).rolls.join() === '1,1,1,1', 'Initial dice faces are reproducible');
  await page.evaluate(() => { Math.random = () => 0.999; });
  await locks.nth(0).focus();
  await page.keyboard.press('Space');
  await all.focus();
  await page.keyboard.press('Enter');
  assert((await dice()).rolls.join() === '1,6,6,6', 'Roll all preserves locked die');
  assert(await rerolls.nth(0).isDisabled(), 'Locked individual die cannot reroll');
  await page.evaluate(() => { Math.random = () => 0.2; });
  await rerolls.nth(1).click();
  assert((await dice()).rolls.join() === '1,2,6,6', 'Individual reroll changes only that slot');
  for (let i = 1; i < 4; i++) await locks.nth(i).check();
  assert(await all.isDisabled(), 'Roll all disabled with all dice locked');
  assert((await page.locator('[data-word-lock-status]').textContent()).includes('All four'), 'All-locked state explained');
  await locks.nth(2).uncheck();
  await locks.nth(2).focus();
  await page.keyboard.press('Shift+Tab');
  assert(await rerolls.nth(2).evaluate(element => element.matches(':focus-visible')), 'Native keyboard focus remains visible');
  await page.keyboard.press('Enter');
  assert((await dice()).rolls.join() === '1,2,2,6', 'Unlocked die responds to Enter');
  const phrases = await page.locator('[data-word-phrase]').allTextContents();
  const sentence = `${phrases.join(' ').replace(/^./, first => first.toUpperCase())}.`;
  assert(await page.locator('[data-word-result]').textContent() === sentence, 'Visible phrases match generated line');
  await page.locator('.word-dice-banks summary').click();
  assert(await page.locator('.word-dice-banks li').count() === 24, 'All 24 face mappings readable');
  checks.push('dice face mapping, all/individual rerolls, locks, all-locked feedback and keyboard focus');

  // Isolate clipboard tests from the user's system clipboard.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { window.__copiedV2 = text; },
  } }));
  await page.locator('[data-word-copy]').click();
  assert(await page.evaluate(() => window.__copiedV2) === sentence, 'Copy writes completed line');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw new Error('Clipboard denied for test'); },
  } }));
  await page.locator('[data-word-copy]').click();
  assert(await page.locator('[data-word-manual-copy]').isVisible(), 'Denied copy offers manual fallback');
  assert(await page.locator('[data-word-copy-text]').inputValue() === sentence, 'Fallback contains the exact line');
  checks.push('copy success and denied-permission manual fallback (isolated clipboard stubs)');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-word-roll-all]').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    assert(await locks.nth(2).isVisible() && await page.locator('[data-word-result]').isVisible(), 'Dice remain usable on narrow screens');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await rerolls.nth(2).click();
  assert(!(await page.locator('[data-word-result]').textContent()).includes('undefined'), 'Reduced-motion dice result remains readable');
  const before = await dice();
  await page.evaluate(() => { window.__playV2.destroy(); window.__diceV2.destroy(); });
  assert(!(await state()).running && (await state()).trailParticles.length === 0, 'Teardown releases trail resources');
  await page.evaluate(() => {
    document.querySelector('[data-word-reroll]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.__v2Modules.play.mountPlaygrounds();
    window.__v2Modules.words.mountWordDice();
  });
  assert((await dice()).rolls.join() === before.rolls.join(), 'Destroyed dice ignore events');
  assert(await page.locator('[data-word-die]').evaluateAll(cards => cards.map(card => card.dataset.wordFace).join()) === before.rolls.join(), 'Remount preserves visible faces');
  await page.locator('.play-home').click();
  await page.goBack();
  await page.waitForSelector('[data-word-ready="true"]');
  await page.waitForSelector('[data-play-ready="true"]');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-word-die]')).every(card => {
    const locked = card.querySelector('[data-word-lock]').checked;
    return (card.dataset.wordLocked === 'true') === locked && card.querySelector('[data-word-reroll]').disabled === locked &&
      card.querySelector('[data-word-lock-label]').textContent === (locked ? 'Locked' : 'Lock');
  }), null, { timeout: 2000 });
  assert(await page.locator('[data-word-result]').textContent() !== '', 'Back navigation restores both experiments');
  checks.push('320/390px layout, reduced-motion dice, teardown and Back navigation');
  assert(errors.length === 0, `Runtime errors: ${errors.join(', ')}`);
  return { outcome: 'passed', checks };
}
