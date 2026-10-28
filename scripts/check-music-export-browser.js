async (page) => {
  // Run with playwright-cli run-code. This exercises the production UI and actual
  // browser downloads; no editor/project injection or development imports are used.
  const checks = [], errors = [], downloads = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download));
  await page.setViewportSize({ width: 1180, height: 1000 });
  await page.goto(`${origin}/play/`);
  const root = page.locator('[data-music]');
  const control = name => root.locator(`[data-music-${name}]`);
  const snapshot = () => page.evaluate(() => document.querySelector('[data-music]').musicStudio.getSnapshot());
  const waitReady = id => page.waitForFunction(presetId => {
    const state = document.querySelector('[data-music]').musicStudio.getSnapshot();
    return state.engine?.ready && !state.busy && state.engine.loaded.some(item => item.startsWith(`${presetId}@`));
  }, id, { timeout: 90000 });
  const waitExportFinished = () => page.waitForFunction(() =>
    !document.querySelector('[data-music]').musicStudio.getSnapshot().exporting, null, { timeout: 120000 });
  const waitPromise = async (promise, message, milliseconds = 30000) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
    } finally { clearTimeout(timer); }
  };
  const record = async (letter, duration) => {
    await control('record').click();
    await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().state === 'recording');
    await root.focus(); await page.keyboard.down(letter);
    await page.waitForTimeout(duration); // Actual performed note length, not a readiness sleep.
    await page.keyboard.up(letter);
    await page.waitForTimeout(100);
    await control('record').click();
    await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().state === 'stopped');
  };
  await page.waitForFunction(() => !!document.querySelector('[data-music]')?.musicStudio);
  assert(await control('export-mix').isDisabled() && await control('export-stems').isDisabled(), 'Empty arrangements cannot export');
  await control('enable').click(); await waitReady('gu-piano');
  await record('a', 550);
  let state = await snapshot();
  const pianoId = state.project.tracks[0].id;
  const pianoTake = state.project.takes[state.project.tracks[0].clips[0].takeId];
  assert(pianoTake.preset.id === 'gu-piano', 'The first take uses SoundFont piano');
  await control('add-instrument').selectOption('harmonica');
  await control('add').click(); await waitReady('gu-harmonica');
  await control('preset').selectOption('vcsl-harmonica'); await waitReady('vcsl-harmonica');
  await control('stop').click();
  await control('record').click();
  await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().state === 'recording');
  assert(await control('export-mix').isDisabled() && await control('export-stems').isDisabled(), 'Recording disables both export actions');
  await root.focus(); await page.keyboard.down('d');
  await page.waitForTimeout(2800); // Goes beyond the Super 64 sustain-loop boundary.
  await page.keyboard.up('d'); await page.waitForTimeout(100);
  await control('record').click();
  state = await snapshot();
  const harmonicaId = state.selectedTrackId;
  const harmonicaClip = state.project.tracks.find(item => item.id === harmonicaId).clips[0];
  await root.locator(`[data-music-clip="${harmonicaClip.id}"]`).click();
  await control('clip-start').fill('1.25'); await control('move').click();
  // New performance choices must not change the instrument/key/volume of either take.
  await control('preset').selectOption('gu-harmonica'); await waitReady('gu-harmonica');
  await control('key').selectOption('9');
  await control('volume').evaluate(input => { input.value = '0.2'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await control('stop').click();
  await control('seek').evaluate(input => { input.value = '0.25'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  state = await snapshot();
  const projectBefore = JSON.stringify(state.project), positionBefore = state.position;
  const musicalEvents = state.project.tracks.flatMap(track => track.clips.flatMap(clip => {
    const take = state.project.takes[clip.takeId];
    return take.notes.map(note => ({ track: track.id, preset: take.preset.id, start: clip.start + note.start - clip.sourceStart,
      end: clip.start + note.start + note.duration - clip.sourceStart }));
  }));
  const pianoEvent = musicalEvents.find(event => event.track === pianoId);
  const harmonicaEvent = musicalEvents.find(event => event.track === harmonicaId);
  assert(pianoEvent.preset === 'gu-piano' && harmonicaEvent.preset === 'vcsl-harmonica', 'Saved takes retain both playback backends');
  await page.waitForFunction(() => document.querySelector('[data-music]').musicStudio.getSnapshot().engine.level < 0.000001);
  await page.evaluate(() => {
    window.__exportOutputAudit = { realtimeContexts: 0, destinationConnections: 0 };
    const RealContext = window.AudioContext, connect = AudioNode.prototype.connect;
    window.AudioContext = new Proxy(RealContext, { construct(target, args) {
      window.__exportOutputAudit.realtimeContexts++; return Reflect.construct(target, args);
    } });
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode && destination.context instanceof RealContext) window.__exportOutputAudit.destinationConnections++;
      return connect.call(this, destination, ...args);
    };
  });

  // A failed upstream request must be reported rather than becoming a silent WAV.
  const bankPattern = '**/music/gu-piano.sf2';
  const failBank = route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Instrument temporarily unavailable' });
  await page.route(bankPattern, failBank);
  await control('export-mix').click(); await waitExportFinished();
  assert((await control('export-status').textContent()).match(/503|fail|error|could not|unavailable/i), 'Export reports asset failure');
  assert(await control('export-downloads').locator('a').count() === 0, 'Failed export offers no corrupt download');
  assert(!(await control('export-mix').isDisabled()), 'An asset failure allows retry');
  await page.unroute(bankPattern, failBank);
  assert(JSON.stringify((await snapshot()).project) === projectBefore, 'Failed export does not mutate takes or arrangement');
  checks.push('empty/recording guards, mixed captured presets, explicit asset errors and retry');

  const gateBank = async () => {
    let release, reached;
    const gate = new Promise(resolve => { release = resolve; });
    const hit = new Promise(resolve => { reached = resolve; });
    const handler = async route => { reached(); await gate; try { await route.continue(); } catch { /* terminated worker/page */ } };
    await page.route(bankPattern, handler);
    return { hit, release, remove: () => page.unroute(bankPattern, handler) };
  };
  const cancelGate = await gateBank();
  await control('export-stems').click();
  await waitPromise(cancelGate.hit, 'Export did not request its SoundFont bank');
  assert((await snapshot()).exporting, 'Export is owned while its resource is in flight');
  assert(await control('export-progress').isVisible() && await control('export-cancel').isEnabled(), 'Progress and cancellation are available during work');
  await control('export-cancel').focus(); await page.keyboard.press('Enter');
  await waitExportFinished(); cancelGate.release(); await cancelGate.remove();
  await page.waitForTimeout(200); // Detect a stale completion after cancellation.
  assert(await control('export-downloads').locator('a').count() === 0 && downloads.length === 0, 'Cancelled work cannot publish or automatically download a stale result');
  assert(JSON.stringify((await snapshot()).project) === projectBefore, 'Cancellation preserves the project');
  checks.push('in-flight cancellation, native keyboard activation, no late result and unchanged project');

  const readDownload = async (kind, destination) => {
    const link = control('export-downloads').locator(`[data-music-export-file="${kind}"]`);
    assert(await link.count() === 1 && await link.isVisible(), `${kind}: ready download exists; status: ${await control('export-status').textContent()}`);
    const pending = page.waitForEvent('download'); await link.click();
    const download = await pending; await download.saveAs(destination);
    assert(await download.failure() === null, `${kind}: browser saved the complete download`);
    const stream = await download.createReadStream(); assert(stream, 'Saved download has readable bytes');
    const chunks = []; let length = 0;
    for await (const chunk of stream) { chunks.push(chunk); length += chunk.length; }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, filename: download.suggestedFilename(), destination };
  };
  const ascii = (bytes, start, size) => String.fromCharCode(...bytes.subarray(start, start + size));
  const wav = (bytes, name) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert(ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE', `${name}: actual WAV signature`);
    assert(view.getUint32(4, true) + 8 === bytes.length, `${name}: correct RIFF size`);
    let format, data;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = ascii(bytes, offset, 4), length = view.getUint32(offset + 4, true);
      assert(offset + 8 + length <= bytes.length, `${name}: bounded chunk`);
      if (kind === 'fmt ') format = { code: view.getUint16(offset + 8, true), channels: view.getUint16(offset + 10, true),
        rate: view.getUint32(offset + 12, true), byteRate: view.getUint32(offset + 16, true), alignment: view.getUint16(offset + 20, true), bits: view.getUint16(offset + 22, true) };
      if (kind === 'data') data = bytes.subarray(offset + 8, offset + 8 + length);
      offset += 8 + length + (length % 2);
    }
    assert(format && data && data.length > 0, `${name}: PCM format and data exist`);
    assert(format.code === 1 && format.channels === 2 && format.rate === 44100 && format.bits === 16,
      `${name}: 44.1 kHz stereo PCM16`);
    assert(format.alignment === 4 && format.byteRate === 176400 && data.length % 4 === 0, `${name}: consistent frame layout`);
    const sampleView = new DataView(data.buffer, data.byteOffset, data.byteLength), pcm = new Int16Array(data.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = sampleView.getInt16(i * 2, true);
    const frames = pcm.length / 2;
    const rms = (start, end) => {
      const from = Math.max(0, Math.floor(start * 44100) * 2), to = Math.min(pcm.length, Math.ceil(end * 44100) * 2);
      let sum = 0; for (let i = from; i < to; i++) sum += (pcm[i] / 32768) ** 2;
      return Math.sqrt(sum / Math.max(1, to - from));
    };
    let first = -1, peak = 0;
    for (let i = 0; i < pcm.length; i++) { peak = Math.max(peak, Math.abs(pcm[i])); if (first === -1 && Math.abs(pcm[i]) > 2) first = Math.floor(i / 2) / 44100; }
    assert(peak > 10, `${name}: saved audio contains non-silent samples`);
    return { ...format, pcm, frames, seconds: frames / 44100, rms, first, peak };
  };
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let value = i; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0;
  });
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const unzip = bytes => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
    assert(end >= 0, 'ZIP has an end-of-central-directory record');
    const count = view.getUint16(end + 10, true), files = [];
    let central = view.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      assert(view.getUint32(central, true) === 0x02014b50, 'ZIP central directory entry is valid');
      const method = view.getUint16(central + 10, true), crc = view.getUint32(central + 16, true);
      const size = view.getUint32(central + 20, true), expanded = view.getUint32(central + 24, true);
      const nameLength = view.getUint16(central + 28, true), extraLength = view.getUint16(central + 30, true), commentLength = view.getUint16(central + 32, true);
      const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength));
      assert(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), 'ZIP filenames stay relative and safe');
      assert(method === 0 && size === expanded, 'ZIP uses lossless stored entries');
      const local = view.getUint32(central + 42, true);
      assert(view.getUint32(local, true) === 0x04034b50, 'ZIP local entry header is valid');
      const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(offset, offset + size);
      assert(data.length === size && crc32(data) === crc, `${name}: downloaded ZIP payload CRC matches`);
      files.push({ name, bytes: data }); central += 46 + nameLength + extraLength + commentLength;
    }
    assert(new Set(files.map(file => file.name)).size === files.length, 'ZIP filenames are unique');
    return files;
  };

  await control('export-mix').focus(); await page.keyboard.press('Enter'); await waitExportFinished();
  assert(downloads.length === 0, 'Preparing audio never downloads automatically');
  assert(await control('export-downloads').locator('[data-music-export-file="mix"]').isVisible(), 'Completed full mix has an explicit save link');
  const mixFile = await readDownload('mix', 'output/playwright/music-export-mix.wav');
  const mix = wav(mixFile.bytes, mixFile.filename);
  const oldUrl = await control('export-downloads').locator('[data-music-export-file="mix"]').getAttribute('href');
  await control('export-stems').click(); await waitExportFinished();
  assert(downloads.length === 1, 'Preparing stems also waits for an explicit download click');
  const stemsFile = await readDownload('stems', 'output/playwright/music-export-stems.zip');
  const entries = unzip(stemsFile.bytes), stemEntries = entries.filter(file => file.name.endsWith('.wav'));
  assert(stemEntries.length === 2, 'ZIP contains exactly one WAV per nonempty track');
  for (const entry of entries.filter(file => file.name.endsWith('.json'))) JSON.parse(new TextDecoder().decode(entry.bytes));
  const stems = stemEntries.map(file => ({ name: file.name, ...wav(file.bytes, file.name) })).sort((a, b) => a.first - b.first);
  assert(stems.every(stem => stem.frames === mix.frames), 'Mix and all stems share an identical zero origin and frame count');
  assert(stems[0].first >= pianoEvent.start - .002 && stems[0].first < pianoEvent.start + .1, 'Piano stem preserves original start timing');
  assert(stems[1].first >= harmonicaEvent.start - .002 && stems[1].first < harmonicaEvent.start + .1, 'Moved harmonica stem preserves its timeline offset');
  assert(stems[1].rms(0, harmonicaEvent.start - .01) === 0, 'A later stem includes real leading silence');
  assert(stems[1].rms(harmonicaEvent.start + 2.4, harmonicaEvent.start + 2.6) > .00001, 'Exported Super 64 continues through its sustain-loop wrap');
  assert(stems[0].rms(pianoEvent.end + .02, pianoEvent.end + .08) > .000001, 'Piano export includes its note-off release tail');
  assert(stems[1].rms(harmonicaEvent.end + .01, harmonicaEvent.end + .05) > .000001, 'Harmonica export includes its note-off release tail');
  assert(mix.seconds > Math.max(...musicalEvents.map(event => event.end)) + 7.9, 'Full export includes the common tail window');
  assert(stems.every(stem => stem.rms(stem.seconds - .25, stem.seconds) < .000001), 'Export tail ends quietly');
  let largestError = 0, squareError = 0;
  for (let i = 0; i < mix.pcm.length; i++) {
    const error = Math.abs(mix.pcm[i] - stems.reduce((sum, stem) => sum + stem.pcm[i], 0));
    largestError = Math.max(largestError, error); squareError += error * error;
  }
  assert(largestError <= 6, `Summed stems reproduce the mix within PCM rounding (${largestError} LSB maximum)`);
  const unchanged = await snapshot();
  assert(JSON.stringify(unchanged.project) === projectBefore && Math.abs(unchanged.position - positionBefore) < .001,
    'Successful exports preserve source takes, clip edits, performance settings and playback position');
  assert(unchanged.held.length === 0 && unchanged.engine.voices.length === 0 && unchanged.engine.level < .000001,
    'Offline export leaves the live engine silent');
  const outputAudit = await page.evaluate(() => window.__exportOutputAudit);
  assert(outputAudit.realtimeContexts === 0 && outputAudit.destinationConnections === 0, 'Exports create no realtime context or speaker connection');
  assert(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, oldUrl),
    'Preparing a new export revokes the previous download URL');
  checks.push('real saved WAV/ZIP bytes, CRC integrity, captured presets, common alignment, sample loops, natural releases and stem-sum fidelity');
  checks.push('unchanged takes/position, no automatic download, silent offline rendering and stale URL cleanup');

  // Exercise the other native sample collection too, independently of the
  // SoundFont worker's four-preset renderer checks.
  await control('add-instrument').selectOption('piano'); await control('add').click(); await waitReady('gu-piano');
  await control('preset').selectOption('vcsl-piano'); await waitReady('vcsl-piano');
  await control('key').selectOption('0'); await control('stop').click(); await record('a', 550);
  state = await snapshot();
  const thirdTrack = state.project.tracks.find(track => track.id === state.selectedTrackId);
  assert(state.project.takes[thirdTrack.clips[0].takeId].preset.id === 'vcsl-piano', 'Additional export fixture uses the actual VCSL piano take');
  await control('stop').click(); const threeTrackProject = JSON.stringify((await snapshot()).project);
  await control('export-mix').click(); await waitExportFinished();
  const pianoFile = await readDownload('mix', 'output/playwright/music-export-vcsl-piano.wav');
  const pianoMix = wav(pianoFile.bytes, pianoFile.filename);
  assert(pianoMix.frames === mix.frames, 'Adding the short piano preserves the existing arrangement end');
  let pianoDifference = 0;
  for (let i = 0; i < Math.min(44100 * 2, pianoMix.pcm.length); i++) pianoDifference += ((pianoMix.pcm[i] - mix.pcm[i]) / 32768) ** 2;
  assert(Math.sqrt(pianoDifference / (44100 * 2)) > .00001, 'VCSL piano contributes nonzero rendered audio to the saved mix');
  assert(JSON.stringify((await snapshot()).project) === threeTrackProject, 'VCSL piano export leaves the three original takes unchanged');
  checks.push('real VCSL Kawai piano sample export and unchanged source data');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await control('export-stems').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Export controls do not overflow at ${width}px`);
    for (const name of ['export-mix', 'export-stems']) {
      const box = await control(name).boundingBox(); assert(box && box.width >= 44 && box.height >= 44, 'Narrow-screen export controls remain operable');
    }
  }
  checks.push('390/320px export layout and native keyboard controls');

  // Start one more real worker request and tear down while it is held in flight.
  const teardownGate = await gateBank(); const downloadedBeforeTeardown = downloads.length;
  await control('export-mix').click(); await waitPromise(teardownGate.hit, 'Teardown setup did not reach the worker fetch');
  await page.evaluate(() => {
    window.__retiredMusicExport = document.querySelector('[data-music]').musicStudio;
    document.dispatchEvent(new Event('astro:before-swap'));
  });
  teardownGate.release(); await teardownGate.remove();
  await page.waitForFunction(() => window.__retiredMusicExport.getSnapshot().engine.contextState === 'closed');
  await page.waitForTimeout(200);
  assert(downloads.length === downloadedBeforeTeardown && await control('export-downloads').locator('a').count() === 0,
    'Teardown cancels worker work and removes download handles');
  assert(!(await page.evaluate(() => window.__retiredMusicExport.getSnapshot().exporting)), 'Destroyed controller no longer owns an export');
  checks.push('teardown during asset loading, worker cancellation and no stale download');
  assert(errors.length === 0, `Browser runtime errors: ${errors.join('; ')}`);
  return { checks, files: [mixFile.destination, stemsFile.destination, pianoFile.destination], frames: mix.frames, seconds: mix.seconds,
    stems: stems.map(stem => ({ filename: stem.name, firstSound: stem.first, frames: stem.frames })),
    stemSumMaximumErrorLSB: largestError, stemSumRmsErrorLSB: Math.sqrt(squareError / mix.pcm.length), outputAudit };
}
