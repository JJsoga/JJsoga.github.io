async (page) => {
  const checks = [];
  const errors = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const close = (a, b, message) => assert(Math.abs(a - b) < 0.025, `${message}: ${a} versus ${b}`);
  const origin = new URL(page.url()).origin;
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1180, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${origin}/play/`);
  const root = page.locator('[data-music]');
  const control = name => root.locator(`[data-music-${name}]`);
  const snapshot = () => page.evaluate(() => document.querySelector('[data-music]').musicStudio.getSnapshot());
  const focus = async () => { await root.focus(); };
  const waitState = async expected => page.waitForFunction(state =>
    document.querySelector('[data-music]').musicStudio.getSnapshot().state === state, expected, { timeout: 10000 });
  const waitPreset = async id => page.waitForFunction(presetId => {
    const state = document.querySelector('[data-music]').musicStudio.getSnapshot();
    return state.engine?.ready && state.engine.loaded.some(key => key.startsWith(`${presetId}@`))
      && !document.querySelector('[data-music-controls]').disabled;
  }, id, { timeout: 60000 });
  const waitLevel = async () => page.waitForFunction(() => {
    const state = document.querySelector('[data-music]').musicStudio.getSnapshot();
    return state.engine.level > 0.00001;
  }, null, { timeout: 5000 });
  const releaseAllKeys = async () => {
    for (const letter of ['a', 's', 'd', 'f', 'g', 'h', 'j', 'q', 'w', 'e', 'r', 't', 'y', 'u']) await page.keyboard.up(letter);
    await page.keyboard.up('Shift');
  };
  await page.waitForFunction(() => !!document.querySelector('[data-music]')?.musicStudio);
  assert((await snapshot()).engine === null, 'Audio must stay uninitialized until Enable sound');
  await control('enable').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert(await control('enable').evaluate(element => element.matches(':focus-visible')), 'Enable sound has visible keyboard focus');
  await page.keyboard.press('Enter');
  await waitPreset('gu-piano');
  assert((await snapshot()).engine.loaded.length === 1, 'Enabling loads only the selected piano');
  await focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('d');
  let state = await snapshot();
  assert(state.held.length === 1 && state.held[0].pitch === 65, 'Shift+D captures F4 at keydown');
  const firstVoice = state.held[0].id;
  await page.keyboard.up('Shift');
  await page.keyboard.down('d');
  state = await snapshot();
  assert(state.held.length === 1 && state.held[0].id === firstVoice && state.held[0].pitch === 65,
    'Repetition and releasing Shift do not change an already-held note');
  await page.keyboard.down('f');
  state = await snapshot();
  assert(state.held.length === 2 && state.held.every(note => note.pitch === 65), 'Different physical combinations can hold independent unison notes');
  const sounding = state.engine.voices.filter(voice => state.held.some(note => note.id === voice.id));
  assert(sounding.length === 2 && new Set(sounding.map(voice => voice.channel)).size === 2,
    'SoundFont unisons have independent channels');
  await waitLevel();
  await page.keyboard.up('d');
  state = await snapshot();
  assert(state.held.length === 1 && state.held[0].code === 'KeyF', 'Releasing the raised note preserves the natural unison');
  await page.keyboard.up('f');
  assert((await snapshot()).held.length === 0, 'Letter keyup releases the held voice');
  await focus();
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert((await snapshot()).held.length === 0, 'Window blur releases all held notes');
  await page.keyboard.up('a');
  await control('key').focus();
  await page.keyboard.press('a');
  assert((await snapshot()).held.length === 0, 'Native select keyboard use cannot trigger instruments');
  await control('key').selectOption('0');
  checks.push('gesture-only audio, keyboard focus, fixed Shift pitch, repeat rejection, independent unisons, keyup and blur release');

  await control('key').selectOption('5');
  assert((await control('note-label').allTextContents())[0] === 'F4', 'F major relabels the lower octave');
  assert((await control('note-label').allTextContents())[3] === 'B♭4', 'F major shows B flat');
  await control('key').selectOption('2');
  assert((await control('note-label').allTextContents())[2] === 'F♯4', 'D major shows F sharp');
  await control('key').selectOption('9');
  assert((await control('note-label').allTextContents())[2] === 'C♯5', 'A major shows C sharp');
  await control('octave-up').click();
  assert((await control('note-label').allTextContents())[0] === 'A5', 'Octave-up changes performance labels');
  await control('octave-down').click();
  await control('key').selectOption('0');
  checks.push('C/F/D/A major mappings and both octave controls update displayed pitches');

  const recordPhrase = async (firstLetter, secondLetter) => {
    await control('record').click();
    await waitState('recording');
    await focus();
    await page.keyboard.down(firstLetter);
    await page.waitForTimeout(650); // Recorded human-scale note duration, not a readiness wait.
    await page.keyboard.down(secondLetter);
    await page.waitForTimeout(450);
    await page.keyboard.up(firstLetter);
    await page.waitForTimeout(400);
    await page.keyboard.up(secondLetter);
    await page.waitForTimeout(400);
    await control('record').click();
    await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().state !== 'recording');
  };
  await control('stop').click();
  await recordPhrase('a', 'd');
  state = await snapshot();
  const firstTrackId = state.project.tracks[0].id;
  const firstClipId = state.project.tracks[0].clips[0].id;
  const firstTakeId = state.project.tracks[0].clips[0].takeId;
  const originalTake = JSON.stringify(state.project.takes[firstTakeId]);
  assert(state.project.takes[firstTakeId].notes.length === 2, 'One selected track records two actual key gestures');
  assert(state.project.takes[firstTakeId].notes.every(note => note.duration > 0.5 && note.velocity === 96),
    'Takes store seconds and fixed velocity');
  assert(state.project.takes[firstTakeId].preset.id === 'gu-piano' && state.project.takes[firstTakeId].preset.version,
    'Recorded take snapshots a versioned preset');
  await control('key').selectOption('9');
  await control('volume').focus();
  await page.keyboard.press('ArrowLeft');
  await control('preset').selectOption({ index: 1 });
  const alternativePiano = await control('preset').inputValue();
  await waitPreset(alternativePiano);
  assert(JSON.stringify((await snapshot()).project.takes[firstTakeId]) === originalTake,
    'Key, volume and preset changes do not rewrite an existing take');
  await control('key').selectOption('0');
  await control('add-instrument').selectOption('harmonica');
  await control('add').click();
  await waitPreset('gu-harmonica');
  await control('stop').click();
  await control('record').click();
  await waitState('recording');
  await focus();
  await page.keyboard.down('g');
  await page.waitForTimeout(550);
  state = await snapshot();
  assert(state.engine.voices.some(voice => voice.preset.startsWith('gu-piano@'))
    && state.engine.voices.some(voice => voice.preset.startsWith('gu-harmonica@')),
    'An existing piano take accompanies recording the selected harmonica');
  const activeTrackId = state.selectedTrackId;
  await page.keyboard.down('j');
  await page.waitForTimeout(600);
  await page.keyboard.up('g');
  await page.waitForTimeout(350);
  await page.keyboard.up('j');
  await page.waitForTimeout(400);
  await control('record').click();
  await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().state !== 'recording');
  state = await snapshot();
  assert(state.project.tracks.length === 2 && state.project.tracks.every(track => track.clips.length === 1),
    'Successive recordings produce one take on each selected track');
  assert(state.project.tracks.find(track => track.id === activeTrackId).clips.length === 1, 'Only the selected track receives the second take');
  assert(JSON.stringify(state.project.takes[firstTakeId]) === originalTake, 'Accompaniment leaves the previous take intact');
  checks.push('successive multitrack recording, real accompaniment, actual pitches/durations/velocity and immutable preset/volume snapshots');

  await control('stop').click();
  await control('play').click();
  await waitState('playing');
  await page.waitForTimeout(300);
  const beforeView = await snapshot();
  assert(beforeView.engine.voices.some(voice => voice.preset.startsWith('gu-piano@'))
    && beforeView.engine.voices.some(voice => voice.preset.startsWith('gu-harmonica@')), 'Parallel transport schedules both recorded presets');
  await control('view').selectOption('visual');
  const afterView = await snapshot();
  assert(afterView.state === 'playing' && afterView.position >= beforeView.position && afterView.position - beforeView.position < 0.75,
    'Switching to visual playback preserves ongoing position');
  await page.waitForTimeout(200);
  const later = await snapshot();
  close(later.position - afterView.position, later.engine.currentTime - afterView.engine.currentTime,
    'Visual playback position advances on the shared audio clock');
  await control('view').selectOption('timeline');
  assert((await snapshot()).state === 'playing', 'Returning to the timeline does not stop transport');
  await control('pause').click();
  const paused = await snapshot();
  await page.waitForTimeout(150);
  close((await snapshot()).position, paused.position, 'Pause freezes the shared playback position');
  await control('view').selectOption('visual');
  await control('shapes').selectOption('triangle');
  assert(await control('canvas').isVisible(), 'Visual canvas appears with configurable shapes');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pixels = await control('canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.reduce((sum, byte, index) => (sum + byte * ((index % 17) + 1)) % 2147483647, 0);
  });
  const visualDescription = await control('visual-description').textContent();
  const visualTakes = JSON.stringify((await snapshot()).project.takes);
  await control('key').selectOption('5');
  assert(pixels > 0 && await control('visual-description').textContent() === visualDescription
    && JSON.stringify((await snapshot()).project.takes) === visualTakes,
    'Visual notes remain derived from the stored pitches rather than the current performance key');
  await control('key').selectOption('0');
  await control('view').selectOption('timeline');
  checks.push('parallel playback, one audio clock, seamless view switches, pause and pitch-based visual independence');

  await control('stop').click();
  await root.locator(`[data-music-clip="${firstClipId}"]`).click();
  await control('clip-start').fill('1.2');
  await control('clip-start').focus();
  await page.keyboard.down('a');
  assert((await snapshot()).held.length === 0, 'Typing in numeric editing fields cannot play notes');
  await page.keyboard.up('a');
  await control('move').click();
  state = await snapshot();
  let clip = state.project.tracks.find(track => track.id === firstTrackId).clips[0];
  close(clip.start, 1.2, 'Move updates the selected clip start');
  const sourceOut = clip.duration - 0.1;
  await control('clip-in').fill('0.1');
  await control('clip-out').fill(String(sourceOut));
  await control('trim').click();
  state = await snapshot();
  clip = state.project.tracks.find(track => track.id === firstTrackId).clips[0];
  close(clip.start, 1.3, 'Left trim preserves retained notes’ absolute timing');
  close(clip.sourceStart, 0.1, 'Trim updates only the clip source window');
  await control('clip-split').fill(String(clip.start + clip.duration / 2));
  await control('split').click();
  state = await snapshot();
  const pieces = state.project.tracks.find(track => track.id === firstTrackId).clips;
  assert(pieces.length === 2 && pieces.every(piece => piece.takeId === firstTakeId), 'Split keeps two windows onto the same original take');
  close(pieces[0].start + pieces[0].duration, pieces[1].start, 'Split pieces stay adjacent');
  assert(JSON.stringify(state.project.takes[firstTakeId]) === originalTake, 'Move, trim and split cannot rewrite original notes');
  await control('delete').click();
  state = await snapshot();
  assert(state.project.tracks.find(track => track.id === firstTrackId).clips.length === 1, 'Delete removes only the selected clip');
  assert(JSON.stringify(state.project.takes[firstTakeId]) === originalTake, 'Remaining split piece retains the original take');
  checks.push('native editing fields, move, trim, split and delete preserve source notes and recorded levels');

  await control('add-instrument').selectOption('guitar');
  await control('add').click();
  await waitPreset('gu-guitar');
  const presetResults = [];
  for (let track = 0; track < 3; track++) {
    await control('tracks').locator('button').nth(track).click();
    const options = await control('preset').locator('option').evaluateAll(options => options.map(option => option.value));
    assert(options.length === 2, 'Each instrument has a GeneralUser preset and a complementary source');
    for (const presetId of options) {
      await control('preset').selectOption(presetId);
      await waitPreset(presetId);
      await focus();
      await page.keyboard.down('a');
      await waitLevel();
      const voiced = await snapshot();
      assert(voiced.engine.voices.some(voice => voice.preset.startsWith(`${presetId}@`) && voice.pitch === 60),
        `${presetId}: note uses its actual loaded instrument`);
      const peak = voiced.engine.level;
      if (track === 1) {
        await page.waitForTimeout(2200); // Exercise a held harmonica beyond its attack.
        assert((await snapshot()).engine.level > 0.00001, `${presetId}: harmonica sustains while held`);
      }
      await page.keyboard.up('a');
      assert((await snapshot()).held.length === 0, `${presetId}: release clears physical ownership`);
      presetResults.push({ preset: presetId, rms: Number(peak.toFixed(6)) });
    }
  }
  const loaded = (await snapshot()).engine.loaded;
  assert(loaded.length === 6 && new Set(loaded).size === 6, 'The six requested resources are cached once');
  await control('preset').selectOption({ index: 0 });
  await waitPreset('gu-guitar');
  assert((await snapshot()).engine.loaded.length === 6, 'Returning to an instrument reuses its loaded assets');
  await root.locator('[data-music-note="KeyA"]').focus();
  await page.keyboard.down('Space');
  assert((await snapshot()).held.length === 1, 'Space starts a keyboard-focused on-screen note');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Space');
  assert((await snapshot()).held.length === 0, 'Tabbing within the component before releasing Space cannot leave a stuck note');
  checks.push('all six real presets load on demand, emit measurable audio, sustain harmonica and reuse cached resources');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await control('keyboard').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
    const noteButton = root.locator('[data-music-note="KeyA"]');
    const box = await noteButton.boundingBox();
    assert(box && box.width >= 32 && box.height >= 44, 'Narrow-screen note buttons remain operable');
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    assert((await snapshot()).held.length === 1, 'Touch press plays an on-screen note');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert((await snapshot()).held.length === 0, 'Touch cancellation releases its note');
    await touch.detach();
  }
  await control('sharp').check();
  await control('note').first().focus();
  await page.keyboard.down('Space');
  assert((await snapshot()).held.some(note => note.pitch === 61), 'Keyboard activation of on-screen notes honors the sharp toggle');
  await page.keyboard.up('Space');
  assert((await snapshot()).held.length === 0, 'On-screen keyboard activation releases on keyup');
  await control('sharp').uncheck();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await control('view').selectOption('visual');
  await control('stop').click();
  await control('play').click();
  await waitState('playing');
  assert(await control('canvas').isVisible(), 'Reduced-motion mode keeps musical visual feedback available');
  await page.waitForTimeout(200);
  assert((await snapshot()).position > 0, 'Reduced motion does not pause musical timing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().engine.contextState !== 'running');
  assert((await snapshot()).held.length === 0, 'Hidden-page handling silences held notes');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await releaseAllKeys();
  await page.evaluate(() => {
    window.__musicRetired = document.querySelector('[data-music]').musicStudio;
    document.dispatchEvent(new Event('astro:before-swap'));
  });
  await page.waitForFunction(() => window.__musicRetired.getSnapshot().engine.contextState === 'closed');
  const retired = await page.evaluate(() => window.__musicRetired.getSnapshot());
  assert(retired.held.length === 0 && retired.engine.voices.length === 0 && retired.engine.loaded.length === 0,
    'Teardown closes audio, clears held voices and releases loaded resources');
  await focus();
  await page.keyboard.press('a');
  assert((await page.evaluate(() => window.__musicRetired.getSnapshot())).held.length === 0, 'Destroyed controller ignores keyboard input');
  checks.push('320/390px layout, real touch cancellation, keyboard note buttons, reduced motion, hidden-page suspension and teardown');

  // A fresh document may restore native form values after pageshow. Owned state,
  // visible notes and actual performance must remain synchronized after Back.
  await page.goto(`${origin}/play/`);
  await page.waitForFunction(() => !!document.querySelector('[data-music]')?.musicStudio);
  await control('enable').click();
  await waitPreset('gu-piano');
  await control('key').selectOption('2');
  assert((await control('note-label').allTextContents())[0] === 'D4', 'Back-navigation setup starts in D major');
  await page.locator('.play-home').click();
  await page.goBack();
  await page.waitForFunction(() => !!document.querySelector('[data-music]')?.musicStudio);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await control('enable').click();
  await waitPreset('gu-piano');
  const restoredTonic = Number(await control('key').inputValue());
  const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  assert((await control('note-label').allTextContents())[0] === `${names[restoredTonic]}4`,
    'After Back, musical-key selection and the A-button label agree');
  await focus();
  await page.keyboard.down('a');
  assert((await snapshot()).held.length === 1 && (await snapshot()).held[0].pitch === 60 + restoredTonic,
    'After Back, the played pitch matches the restored selector and note label');
  await page.keyboard.up('a');
  assert(await control('credits').locator('.music-credits').count() === 6, 'Back navigation renders exactly six preset credits');
  await page.evaluate(() => document.querySelector('[data-music]').musicStudio.destroy());
  checks.push('Space/Tab release ownership and real Back-navigation form, label, pitch and credit synchronization');
  assert(errors.length === 0, `Runtime errors: ${errors.join('; ')}`);
  return { outcome: 'passed', checks, presets: presetResults };
}
