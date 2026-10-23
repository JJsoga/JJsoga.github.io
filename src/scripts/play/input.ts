import type { Point } from './types';

type InputHandlers = {
  move: (point: Point, delta: Point, movement: { elapsedSeconds: number; source: 'pointer' | 'keyboard' }) => void;
  start: (point: Point, source: 'pointer' | 'keyboard') => boolean;
  end: (velocity: Point) => void;
  leave: () => void;
  cancel: () => void;
  reset: () => void;
};

/** One active pointer; cancellation is deliberately different from release. */
export function bindInput(canvas: HTMLCanvasElement, handlers: InputHandlers) {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let activeId: number | null = null;
  let previous: Point | null = null;
  let velocity: Point = { x: 0, y: 0 };
  let lastMove = 0;
  let keyboardGrab = false;
  let keyboardPoint: Point | null = null;

  const position = (event: PointerEvent): Point => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const releaseCapture = () => {
    const id = activeId;
    activeId = null;
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const cancel = () => {
    releaseCapture();
    keyboardGrab = false;
    keyboardPoint = null;
    previous = null;
    velocity = { x: 0, y: 0 };
    handlers.cancel();
  };

  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || activeId !== null) return;
    if (keyboardGrab) cancel();
    canvas.focus({ preventScroll: true });
    previous = position(event);
    keyboardPoint = null;
    velocity = { x: 0, y: 0 };
    lastMove = event.timeStamp;
    if (handlers.start(previous, 'pointer')) {
      activeId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    }
  }, options);

  canvas.addEventListener('pointermove', event => {
    if (keyboardGrab) return;
    if (!event.isPrimary || (activeId !== null && event.pointerId !== activeId)) return;
    if (event.pointerType !== 'mouse' && activeId === null) return;
    const point = position(event);
    const delta = previous ? { x: point.x - previous.x, y: point.y - previous.y } : { x: 0, y: 0 };
    const elapsed = previous ? event.timeStamp - lastMove : 0;
    if (elapsed > 0) {
      velocity = { x: delta.x / Math.max(8, elapsed) * 1000,
        y: delta.y / Math.max(8, elapsed) * 1000 };
    }
    previous = point;
    lastMove = event.timeStamp;
    handlers.move(point, delta, { elapsedSeconds: Math.max(0, elapsed) / 1000, source: 'pointer' });
  }, options);

  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== activeId) return;
    releaseCapture();
    handlers.end(event.timeStamp - lastMove > 90 ? { x: 0, y: 0 } : velocity);
    previous = null;
    // Touch has no hover. Mouse also stops applying force after an explicit release.
    handlers.leave();
  }, options);
  canvas.addEventListener('pointercancel', event => {
    if (event.pointerId === activeId) cancel();
  }, options);
  canvas.addEventListener('lostpointercapture', event => {
    if (event.pointerId === activeId) cancel();
  }, options);
  canvas.addEventListener('pointerleave', () => {
    if (activeId === null) {
      previous = null;
      handlers.leave();
    }
  }, options);
  canvas.addEventListener('blur', cancel, options);
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      handlers.reset();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
    if (activeId !== null) return;
    event.preventDefault();
    const box = canvas.getBoundingClientRect();
    keyboardPoint ??= { x: box.width / 2, y: box.height / 2 };
    if (event.key === 'Enter') {
      if (event.repeat) return;
      if (keyboardGrab) {
        handlers.end(performance.now() - lastMove > 180 ? { x: 0, y: 0 } : velocity);
        keyboardGrab = false;
      } else keyboardGrab = handlers.start(keyboardPoint, 'keyboard');
    } else {
      const amount = event.shiftKey ? 40 : 20;
      const next = {
        x: Math.max(0, Math.min(box.width, keyboardPoint.x +
          (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0))),
        y: Math.max(0, Math.min(box.height, keyboardPoint.y +
          (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0))),
      };
      const delta = { x: next.x - keyboardPoint.x, y: next.y - keyboardPoint.y };
      keyboardPoint = next;
      velocity = { x: delta.x * 12, y: delta.y * 12 };
      const now = performance.now();
      const elapsedSeconds = Math.max(0, now - lastMove) / 1000;
      lastMove = now;
      previous = null;
      handlers.move(next, delta, { elapsedSeconds, source: 'keyboard' });
    }
  }, options);

  return { cancel, destroy() { cancel(); listeners.abort(); } };
}
