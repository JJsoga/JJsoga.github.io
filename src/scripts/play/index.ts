import { PLAY_CONFIG } from './config';
import { regroupScene, resetScene, scatterScene, stepScene, throwScene, translateScene } from './behaviors';
import { bindInput } from './input';
import { PlayRenderer } from './renderer';
import { breakTrail, clearTrail, createTrailState, emitTrail, stepTrail } from './trails';
import type { BehaviorSettings, Mode, Pointer, Sample } from './types';

const HELP: Record<Mode, string> = {
  push: 'Move your pointer near the letters or tiles. On touch, press and sweep. Move away to let them return.',
  grab: 'Drag the sample, then release to throw it. It slows down and stays inside the stage. Reset brings it home.',
  scatter: 'Scatter the sample, then move or touch to repel or attract its pieces. Regroup brings every piece home.',
};

/** Mount on any Playground component. Modes can be enabled independently. */
export function createPlayground(root: HTMLElement, options: { enabledModes?: readonly Mode[] } = {}) {
  const find = <T extends HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing playground element: ${selector}`);
    return element;
  };
  const canvas = find<HTMLCanvasElement>('[data-play-canvas]');
  const controls = find<HTMLFieldSetElement>('[data-play-controls]');
  const sampleSelect = find<HTMLSelectElement>('[data-play-sample]');
  const strength = find<HTMLInputElement>('[data-play-strength]');
  const trailToggle = find<HTMLInputElement>('[data-play-trail]');
  const force = find<HTMLSelectElement>('[data-play-force]');
  const status = find('[data-play-status]');
  const enabledModes = options.enabledModes?.length ? options.enabledModes : PLAY_CONFIG.enabledModes;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const settings: BehaviorSettings = { mode: enabledModes[0], strength: 1, force: 'repel', reducedMotion: reduced.matches };
  const pointer: Pointer = { x: 0, y: 0, active: false };
  const trail = createTrailState();
  let trailEnabled: boolean = PLAY_CONFIG.trail.enabled;
  let trailSource: 'pointer' | 'keyboard' | null = null;
  const images = new Map<Sample, HTMLImageElement>();
  const pendingImages = new Map<Sample, Promise<HTMLImageElement>>();
  const listeners = new AbortController();
  let sample: Sample = 'text';
  let destroyed = false;
  let visible = true;
  let frame = 0;
  let resizeFrame = 0;
  let lastTime = 0;
  let framesRemaining = 0;
  let loadVersion = 0;
  canvas.hidden = false;
  const renderer = new PlayRenderer(canvas);
  let scene = renderer.layout(sample);
  const announce = (message: string) => { status.textContent = message; };
  const draw = () => {
    canvas.dataset.grabbing = String(scene.grabbed);
    renderer.draw(scene, images.get(sample), pointer,
      settings.mode === 'grab' ? 12 : PLAY_CONFIG.interactionRadius, trail.particles);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  };
  const tick = (time: number) => {
    frame = 0;
    if (destroyed || !visible || document.hidden) return;
    const dt = lastTime ? (time - lastTime) / 1000 : 1 / 60;
    lastTime = time;
    const moving = stepScene(scene, pointer, settings, dt);
    const trailing = stepTrail(trail, dt);
    draw();
    // Hard bound per input even if future effects fail to converge.
    if (!settings.reducedMotion && ((moving && --framesRemaining > 0) || trailing)) {
      frame = requestAnimationFrame(tick);
    }
    else lastTime = 0;
  };
  const wake = () => {
    if (destroyed || !visible || document.hidden) return;
    framesRemaining = 600;
    if (settings.reducedMotion) {
      stop();
      clearTrail(trail);
      stepScene(scene, pointer, settings, 0);
      draw();
    } else if (!frame) frame = requestAnimationFrame(tick);
  };
  const cancelMotion = () => {
    const wasGrabbed = scene.grabbed;
    scene.grabbed = false;
    pointer.active = false;
    clearTrail(trail);
    trailSource = null;
    for (const particle of scene.particles) particle.vx = particle.vy = 0;
    if (wasGrabbed) announce('Gesture cancelled. The sample has stopped; grab it again or reset.');
    wake();
  };
  const syncControls = () => {
    sampleSelect.value = sample;
    for (const radio of root.querySelectorAll<HTMLInputElement>('[data-play-mode]')) {
      radio.disabled = !enabledModes.includes(radio.value as Mode);
      radio.checked = radio.value === settings.mode;
    }
    strength.value = String(settings.strength);
    trailToggle.checked = trailEnabled;
    trailToggle.disabled = settings.reducedMotion;
    find('[data-play-trail-note]').hidden = !settings.reducedMotion;
    find<HTMLOutputElement>('[data-play-strength-value]').textContent = `${settings.strength.toFixed(2).replace(/0$/, '')}×`;
    force.value = settings.force;
    find('[data-play-scatter-controls]').hidden = settings.mode !== 'scatter';
    find('[data-play-help]').textContent = HELP[settings.mode];
    find('[data-play-reduced]').hidden = !settings.reducedMotion;
    canvas.dataset.mode = settings.mode;
  };
  const reset = () => {
    ++loadVersion;
    sampleSelect.value = sample;
    input.cancel();
    stop();
    resetScene(scene);
    draw();
    announce('Reset. Every piece is back in place. Your chosen sample, mode and strength are unchanged.');
  };
  const input = bindInput(canvas, {
    move(point, delta, movement) {
      Object.assign(pointer, point, { active: true });
      if (scene.grabbed) translateScene(scene, delta.x, delta.y);
      if (trailEnabled && !settings.reducedMotion && visible && !document.hidden) {
        if (trailSource !== movement.source) breakTrail(trail);
        trailSource = movement.source;
        emitTrail(trail, point, movement.elapsedSeconds, scene);
      }
      wake();
    },
    start(point, source) {
      Object.assign(pointer, point, { active: true });
      breakTrail(trail);
      trailSource = source;
      if (trailEnabled && !settings.reducedMotion && visible && !document.hidden) {
        emitTrail(trail, point, 0, scene);
      }
      if (settings.mode === 'grab') {
        const xs = scene.particles.map(p => p.x - p.width / 2);
        const ys = scene.particles.map(p => p.y - p.height / 2);
        const right = Math.max(...scene.particles.map(p => p.x + p.width / 2));
        const bottom = Math.max(...scene.particles.map(p => p.y + p.height / 2));
        if (point.x < Math.min(...xs) - 12 || point.x > right + 12 ||
            point.y < Math.min(...ys) - 12 || point.y > bottom + 12) {
          announce('Grab the visible sample to move it.');
          wake();
          return false;
        }
        scene.grabbed = true;
        for (const p of scene.particles) p.vx = p.vy = 0;
        announce('Grabbed. Move, then release.');
      }
      wake();
      return true;
    },
    end(velocity) {
      if (scene.grabbed) {
        scene.grabbed = false;
        if (!settings.reducedMotion) throwScene(scene, velocity.x, velocity.y, settings.strength);
        announce(settings.reducedMotion ? 'Placed. Reduced motion keeps the sample still.' : 'Released. The sample slows to a stop.');
      }
      wake();
    },
    leave() {
      pointer.active = false;
      breakTrail(trail);
      trailSource = null;
      wake();
    },
    cancel: cancelMotion,
    reset,
  });
  const on = (element: EventTarget, event: string, listener: EventListener) =>
    element.addEventListener(event, listener, { signal: listeners.signal });

  on(controls, 'change', event => {
    const target = event.target as HTMLInputElement;
    if (!target.matches('[data-play-mode]') || !enabledModes.includes(target.value as Mode)) return;
    input.cancel();
    resetScene(scene);
    settings.mode = target.value as Mode;
    if (settings.mode === 'scatter') scatterScene(scene, settings.strength, settings.reducedMotion);
    syncControls();
    announce(`${settings.mode === 'push' ? 'Push and recover' : settings.mode === 'grab' ? 'Grab and throw' : 'Scatter and regroup'} selected.`);
    wake();
  });
  on(strength, 'input', () => {
    settings.strength = Math.max(0.25, Math.min(2, Number(strength.value) || 1));
    syncControls();
    wake();
  });
  on(trailToggle, 'change', () => {
    trailEnabled = trailToggle.checked;
    clearTrail(trail);
    trailSource = null;
    announce(trailEnabled ? 'Trail on. Move inside the stage to leave a fading trail.' : 'Trail off.');
    wake();
  });
  on(force, 'change', () => {
    settings.force = force.value === 'attract' ? 'attract' : 'repel';
    announce(`${settings.force === 'attract' ? 'Attract' : 'Repel'} selected. Move or touch the scattered pieces.`);
    wake();
  });
  on(find('[data-play-reset]'), 'click', reset);
  on(find('[data-play-scatter]'), 'click', () => {
    input.cancel();
    scatterScene(scene, settings.strength, settings.reducedMotion);
    announce('Scattered. Move or touch to interact with the pieces.');
    wake();
  });
  on(find('[data-play-regroup]'), 'click', () => {
    input.cancel();
    regroupScene(scene, settings.reducedMotion);
    announce('Regrouping. Every piece returns to its original place.');
    wake();
  });
  const loadImage = (selected: Sample, source: string) => {
    const pending = pendingImages.get(selected);
    if (pending) return pending;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const cleanup = () => {
        image.onload = image.onerror = null;
        listeners.signal.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        cleanup();
        image.src = '';
        reject(new Error('Image load cancelled'));
      };
      image.onload = () => { cleanup(); resolve(image); };
      image.onerror = () => { cleanup(); reject(new Error('Image could not be loaded')); };
      listeners.signal.addEventListener('abort', cancel, { once: true });
      image.src = source;
    }).then(image => {
      if (!destroyed) images.set(selected, image);
      return image;
    }).finally(() => pendingImages.delete(selected));
    pendingImages.set(selected, promise);
    return promise;
  };
  on(sampleSelect, 'change', async () => {
    const version = ++loadVersion;
    const selected = sampleSelect.value as Sample;
    input.cancel();
    stop();
    announce('Loading sample…');
    try {
      if (selected !== 'text' && !images.has(selected)) {
        const source = selected === 'card' ? root.dataset.cardSrc : root.dataset.markSrc;
        if (!source) throw new Error('Missing image source');
        const image = await loadImage(selected, source);
        if (destroyed || version !== loadVersion) return;
        images.set(selected, image);
      }
      if (destroyed || version !== loadVersion) return;
      sample = selected;
      scene = renderer.layout(sample, images.get(sample));
      if (settings.mode === 'scatter') scatterScene(scene, settings.strength, settings.reducedMotion);
      announce(`${sampleSelect.selectedOptions[0].text} ready.`);
      wake();
    } catch {
      if (destroyed || version !== loadVersion) return;
      sampleSelect.value = sample;
      announce('That image could not load. The previous sample is still available.');
      wake();
    }
  });
  on(reduced, 'change', () => {
    input.cancel();
    stop();
    settings.reducedMotion = reduced.matches;
    resetScene(scene);
    syncControls();
    draw();
    announce(settings.reducedMotion ? 'Reduced motion enabled: direct movement, no inertia or animated recovery.' : 'Full motion enabled.');
  });
  const pause = () => { input.cancel(); stop(); draw(); };
  on(window, 'blur', pause);
  on(window, 'focus', wake);
  on(document, 'visibilitychange', () => { if (document.hidden) pause(); else wake(); });
  const resize = new ResizeObserver(() => {
    if (resizeFrame || destroyed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const bounds = canvas.getBoundingClientRect();
      if (Math.abs(bounds.width - scene.width) < 0.5 && Math.abs(bounds.height - scene.height) < 0.5) return;
      input.cancel();
      stop();
      scene = renderer.layout(sample, images.get(sample));
      draw();
      announce('Stage resized. The sample is back in place.');
    });
  });
  resize.observe(canvas);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!visible) pause(); else wake();
  });
  intersection.observe(canvas);
  controls.disabled = false;
  find('[data-play-fallback]').hidden = true;
  syncControls();
  draw();
  root.dataset.playReady = 'true';

  return {
    reset,
    /** A read-only snapshot supports embedding and deterministic verification. */
    getSnapshot: () => ({ mode: settings.mode, sample, running: frame !== 0,
      reducedMotion: settings.reducedMotion, pointer: { ...pointer },
      trailEnabled: trailEnabled && !settings.reducedMotion,
      trailParticles: trail.particles.map(p => ({ ...p })),
      ...scene, particles: scene.particles.map(p => ({ ...p })) }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ++loadVersion;
      input.destroy();
      stop();
      cancelAnimationFrame(resizeFrame);
      resize.disconnect();
      intersection.disconnect();
      listeners.abort();
      images.clear();
      pendingImages.clear();
      controls.disabled = true;
      canvas.hidden = true;
      find('[data-play-fallback]').hidden = false;
      delete root.dataset.playReady;
    },
  };
}

const instances = new Map<HTMLElement, ReturnType<typeof createPlayground>>();
export function mountPlaygrounds() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-playground]')) {
    if (instances.has(root)) continue;
    try {
      const enabledModes = root.dataset.playModes?.split(',')
        .filter((mode): mode is Mode => PLAY_CONFIG.enabledModes.includes(mode as Mode));
      instances.set(root, createPlayground(root, { enabledModes }));
    }
    catch {
      root.querySelector<HTMLCanvasElement>('canvas')?.setAttribute('hidden', '');
      const status = root.querySelector('[data-play-status]');
      if (status) status.textContent = 'The playground could not start. The original content is available below.';
    }
  }
}
function unmountPlaygrounds() {
  for (const instance of instances.values()) instance.destroy();
  instances.clear();
}
document.addEventListener('astro:before-swap', unmountPlaygrounds);
document.addEventListener('astro:page-load', mountPlaygrounds);
window.addEventListener('pagehide', unmountPlaygrounds);
window.addEventListener('pageshow', mountPlaygrounds);
