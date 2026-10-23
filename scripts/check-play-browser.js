async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const checks = [];
  const pass = message => checks.push(message);
  const snapshot = () => page.evaluate(() => window.__playTest.getSnapshot());
  const offset = state => Math.max(...state.particles.map(p => Math.hypot(p.x - p.homeX, p.y - p.homeY)));
  const speed = state => Math.max(...state.particles.map(p => Math.hypot(p.vx, p.vy)));
  const samePositions = (a, b, tolerance = 0.1) => a.particles.every((p, i) =>
    Math.hypot(p.x - b.particles[i].x, p.y - b.particles[i].y) <= tolerance);
  const canvas = () => page.locator('[data-playground]').first().locator('[data-play-canvas]');
  const chooseMode = async mode => {
    await page.locator('[data-playground]').first().locator('label').filter({
      has: page.locator(`[data-play-mode][value="${mode}"]`),
    }).click();
    await page.waitForFunction(value => window.__playTest.getSnapshot().mode === value, mode);
  };
  const reset = async () => {
    await page.locator('[data-play-reset]').first().click();
    assert(offset(await snapshot()) < 0.1, 'Reset must restore all original positions');
  };
  const settle = () => page.waitForFunction(() => !window.__playTest.getSnapshot().running, null, { timeout: 4500 });
  const center = async () => {
    await canvas().scrollIntoViewIfNeeded();
    const box = await canvas().boundingBox();
    const state = await snapshot();
    const xs = state.particles.map(p => p.x);
    const ys = state.particles.map(p => p.y);
    return { x: box.x + (Math.min(...xs) + Math.max(...xs)) / 2,
      y: box.y + (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  const mouseGrab = async (dx = 55, dy = 24) => {
    const point = await center();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    assert((await snapshot()).grabbed, 'Pointer down over sample must grab');
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
    assert(offset(await snapshot()) > 10, 'Dragging must move visible sample');
  };
  const bounded = state => state.particles.length <= 128 && state.particles.every(p =>
    Number.isFinite(p.x + p.y + p.vx + p.vy) &&
    p.x >= p.width / 2 - 0.2 && p.x <= state.width - p.width / 2 + 0.2 &&
    p.y >= p.height / 2 - 0.2 && p.y <= state.height - p.height / 2 + 0.2);

  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('http://localhost:4321/play/');
  await page.waitForSelector('[data-play-ready="true"]');
  await page.evaluate(async () => {
    const module = await import('/src/scripts/play/index.ts');
    document.dispatchEvent(new Event('astro:before-swap'));
    const root = document.querySelector('[data-playground]');
    window.__playModule = module;
    window.__playTest = module.createPlayground(root);
    root.querySelector('canvas').addEventListener('pointerdown', event => {
      window.__playPointerId = event.pointerId;
    });
  });
  await settle();
  assert((await snapshot()).sample === 'text', 'Initial sample should be text');
  assert((await snapshot()).particles.length === 12, 'Text should contain twelve visible glyphs');

  const point = await center();
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => window.__playTest.getSnapshot().particles.some(p =>
    Math.hypot(p.x - p.homeX, p.y - p.homeY) > 5));
  await page.mouse.move(5, 5);
  await settle();
  assert(offset(await snapshot()) < 0.1, 'Push must recover exactly when cursor leaves');
  pass('push, recovery, and idle animation sleep');

  await chooseMode('grab');
  await mouseGrab();
  await page.mouse.up();
  const release = await snapshot();
  assert(!release.grabbed && speed(release) > 1, 'Release should throw with nonzero velocity');
  await page.waitForTimeout(100);
  assert(!samePositions(release, await snapshot(), 1), 'Released sample must continue moving');
  await page.mouse.move(5, 5);
  await settle();
  assert(bounded(await snapshot()), 'Thrown sample must stay within stage');
  pass('native dragging, release inertia, bounded motion, and sleep');

  for (const eventType of ['pointercancel', 'lostpointercapture']) {
    await reset();
    await mouseGrab(45, 18);
    await page.evaluate(type => {
      document.querySelector('[data-play-canvas]').dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: window.__playPointerId, pointerType: 'mouse', isPrimary: true,
      }));
    }, eventType);
    const cancelled = await snapshot();
    assert(!cancelled.grabbed && speed(cancelled) === 0, `${eventType} must cancel without throw`);
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert(samePositions(cancelled, await snapshot()), `${eventType} should keep stopped position`);
  }
  pass('pointer cancellation and capture loss stop without inertia');

  await reset();
  await mouseGrab();
  await page.waitForTimeout(150);
  await page.mouse.up();
  assert(speed(await snapshot()) === 0, 'Paused release must not reuse stale velocity');
  pass('paused release drops stale throw velocity');

  // Real touch events exercise pointer capture and the browser cancellation path.
  await reset();
  const touch = await page.context().newCDPSession(page);
  const touchPoint = await center();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x + 35, y: touchPoint.y + 20, id: 1 }] });
  assert((await snapshot()).grabbed && offset(await snapshot()) > 10, 'Touch should drag the sample');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert(!(await snapshot()).grabbed && speed(await snapshot()) === 0, 'Touch cancellation must stop without inertia');
  await touch.detach();
  pass('native Chromium touch drag and touch cancellation');

  await reset();
  await canvas().focus();
  await page.keyboard.press('Enter');
  assert((await snapshot()).grabbed, 'Enter should grab centered sample');
  await page.keyboard.press('ArrowRight');
  const keyboardMoved = await snapshot();
  assert(offset(keyboardMoved) >= 19, 'Arrow key should move grabbed sample');
  const box = await canvas().boundingBox();
  await page.mouse.move(box.x + 12, box.y + 12);
  assert(samePositions(keyboardMoved, await snapshot()), 'Incidental hover must not move keyboard grab');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  assert(!(await snapshot()).grabbed && speed(await snapshot()) === 0, 'Paused keyboard release must place without throw');
  await page.keyboard.press('Escape');
  assert(offset(await snapshot()) < 0.1, 'Escape should reset');
  pass('keyboard grab, arrow motion, hover isolation, release, and Escape');

  for (const [sample, count] of [['card', 32], ['mark', 36], ['text', 12]]) {
    await page.locator('[data-play-sample]').selectOption(sample);
    await page.waitForFunction(value => window.__playTest.getSnapshot().sample === value, sample);
    const state = await snapshot();
    assert(state.particles.length === count && bounded(state), `${sample} should load bounded local image tiles or letters`);
    assert(await page.locator('[data-play-sample]').inputValue() === sample, 'Sample select must match rendered sample');
  }
  pass('both existing local images load with fixed particle counts');

  await chooseMode('scatter');
  assert((await snapshot()).scattered && offset(await snapshot()) > 20, 'Scatter mode should immediately scatter');
  await page.mouse.move(5, 5);
  await settle();
  assert(bounded(await snapshot()), 'Scattered particles must stay bounded');
  await page.locator('[data-play-regroup]').click();
  await settle();
  assert(!(await snapshot()).scattered && offset(await snapshot()) < 0.1, 'Regroup should restore original arrangement');
  await page.locator('[data-play-scatter]').click();
  await reset();
  assert(!(await snapshot()).scattered && !(await snapshot()).running, 'Reset should clear scatter and animation');
  pass('scatter, regroup, and reset');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__playTest.getSnapshot().reducedMotion);
  await chooseMode('push');
  const reducedPoint = await center();
  await page.mouse.move(reducedPoint.x, reducedPoint.y);
  assert(offset(await snapshot()) > 5 && !(await snapshot()).running, 'Reduced-motion push should move directly without RAF');
  await page.mouse.move(5, 5);
  assert(offset(await snapshot()) < 0.1, 'Reduced-motion push should restore directly');
  await chooseMode('grab');
  await mouseGrab();
  await page.mouse.up();
  assert(speed(await snapshot()) === 0 && !(await snapshot()).running, 'Reduced-motion release should have no inertia');
  await chooseMode('scatter');
  for (const force of ['repel', 'attract']) {
    await page.locator('[data-play-scatter]').click();
    await page.locator('[data-play-force]').selectOption(force);
    const before = await snapshot();
    const p = before.particles[0];
    const bounds = await canvas().boundingBox();
    const cursor = { x: p.x - 24, y: p.y };
    await page.mouse.move(bounds.x + cursor.x, bounds.y + cursor.y);
    const after = await snapshot();
    const beforeDistance = Math.hypot(p.x - cursor.x, p.y - cursor.y);
    const afterDistance = Math.hypot(after.particles[0].x - cursor.x, after.particles[0].y - cursor.y);
    assert(force === 'repel' ? afterDistance > beforeDistance : afterDistance < beforeDistance,
      `${force} must move the selected particle in the stated direction`);
    assert(!after.running && speed(after) === 0, 'Reduced-motion scatter must remain input-driven');
  }
  await page.locator('[data-play-regroup]').click();
  assert(offset(await snapshot()) < 0.1, 'Reduced-motion regroup should be immediate');
  pass('reduced motion, no inertia/RAF, and predictable repel/attract directions');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await canvas().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => Math.abs(window.__playTest.getSnapshot().width -
      document.querySelector('[data-play-canvas]').getBoundingClientRect().width) < 0.5);
    const state = await snapshot();
    assert(bounded(state) && offset(state) < 0.1, `Resize to ${width}px should restore and contain sample`);
    const dimensions = await canvas().evaluate(element => ({ cssWidth: element.getBoundingClientRect().width,
      bufferWidth: element.width, scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert(dimensions.bufferWidth <= Math.ceil(dimensions.cssWidth * 2), 'Canvas buffer must cap DPR at two');
    assert(dimensions.scrollWidth <= dimensions.viewport, 'Play page should not overflow narrow viewport');
  }
  pass('390px and 320px resizing, no page overflow, capped canvas buffer');

  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.evaluate(() => {
    const original = document.querySelector('[data-playground]');
    const clone = original.cloneNode(true);
    clone.dataset.testClone = 'true';
    clone.querySelectorAll('[data-play-mode]').forEach(input => input.name = 'secondary-mode');
    original.after(clone);
    window.__playSecond = window.__playModule.createPlayground(clone, { enabledModes: ['grab'] });
  });
  const isolated = await snapshot();
  await page.evaluate(() => {
    const root = document.querySelector('[data-test-clone]');
    const select = root.querySelector('[data-play-sample]');
    select.value = 'mark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__playSecond.getSnapshot().sample === 'mark');
  assert((await snapshot()).sample === isolated.sample && (await snapshot()).mode === isolated.mode,
    'Second instance must not change first instance selection');
  assert(await page.evaluate(() => Array.from(document.querySelectorAll('[data-test-clone] [data-play-mode]'))
    .every(input => input.value === 'grab' ? !input.disabled : input.disabled)), 'Per-instance enabled modes must be respected');
  await page.evaluate(() => { window.__playSecond.destroy(); document.querySelector('[data-test-clone]').remove(); });
  pass('independent instances and per-instance mode configuration');

  await page.evaluate(() => window.__playTest.destroy());
  const destroyed = await snapshot();
  assert(!destroyed.running && !(await page.locator('[data-playground]').getAttribute('data-play-ready')),
    'Destroy should stop animation and remove ready marker');
  await page.evaluate(() => {
    const target = document.querySelector('[data-play-canvas]');
    target.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 150, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  assert(samePositions(destroyed, await snapshot()), 'Destroyed instance must ignore input');
  await page.evaluate(() => window.__playModule.mountPlaygrounds());
  await page.waitForSelector('[data-play-ready="true"]');
  await page.evaluate(() => document.dispatchEvent(new Event('astro:before-swap')));
  assert(await page.locator('[data-play-ready]').count() === 0, 'Astro before-swap must unmount');
  await page.evaluate(() => document.dispatchEvent(new Event('astro:page-load')));
  await page.waitForSelector('[data-play-ready="true"]');
  pass('destroy ignores input; Astro navigation events cleanly unmount and remount');

  await page.locator('.play-home').click();
  await page.waitForURL('http://localhost:4321/');
  await page.locator('.nav-item--play a').click();
  await page.waitForSelector('[data-play-ready="true"]');
  assert(await page.locator('[data-play-sample]').inputValue() === 'text', 'Fresh navigation should show default sample');
  assert(await page.locator('[data-play-mode][value="push"]').isChecked(), 'Fresh navigation should show default mode');
  await page.goBack();
  await page.waitForURL('http://localhost:4321/');
  await page.goForward();
  await page.waitForSelector('[data-play-ready="true"]');
  assert(await page.locator('[data-play-sample]').inputValue() === 'text', 'History restoration must keep select and scene consistent');
  pass('home/play links, browser back/forward, and control consistency');
  console.log('All browser checks passed. Touch coverage uses Chromium native CDP events.');
  return { outcome: 'passed', checks, touch: 'Chromium native CDP events' };
}
