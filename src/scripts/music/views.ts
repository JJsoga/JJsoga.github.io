import { MUSIC_CONFIG, type PlaybackEvent, type Project, type Shape } from './types';
import { noteName } from './keyboard';

const instrumentStyles = {
  piano: { line: 1.5, shadow: 0 },
  harmonica: { line: 3.5, shadow: 7 },
  guitar: { line: 2.5, shadow: 3 },
};
export function timelineLength(project: Project) {
  return Math.min(MUSIC_CONFIG.maxDuration, Math.max(10, ...project.tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration + 2))));
}
export function renderTimeline(root: HTMLElement, project: Project, selected: string | null) {
  const total = timelineLength(project);
  root.replaceChildren();
  root.style.width = `max(100%, ${Math.max(600, total * 35)}px)`;
  const ruler = document.createElement('div');
  ruler.className = 'music-ruler';
  for (let i = 0; i <= 10; i++) {
    const tick = document.createElement('span'); tick.style.left = `${i * 10}%`;
    tick.textContent = `${(total * i / 10).toFixed(1)}s`; ruler.append(tick);
  }
  root.append(ruler);
  for (const track of project.tracks) {
    const lane = document.createElement('div'); lane.className = 'music-lane';
    const name = document.createElement('div'); name.className = 'music-lane-name'; name.textContent = track.name;
    const clips = document.createElement('div'); clips.className = 'music-lane-clips';
    for (const clip of track.clips) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'music-clip';
      button.dataset.musicClip = clip.id; button.setAttribute('aria-pressed', String(clip.id === selected));
      button.style.left = `${clip.start / total * 100}%`; button.style.width = `${clip.duration / total * 100}%`;
      button.setAttribute('aria-label', `${track.name} clip at ${clip.start.toFixed(2)} seconds, duration ${clip.duration.toFixed(2)} seconds`);
      const label = document.createElement('span'); label.textContent = project.takes[clip.takeId]?.preset.id ?? 'Take';
      const timing = document.createElement('small'); timing.textContent = `${clip.start.toFixed(2)}–${(clip.start + clip.duration).toFixed(2)} s`;
      button.append(label, timing); clips.append(button);
    }
    lane.append(name, clips); root.append(lane);
  }
  const marker = document.createElement('div'); marker.className = 'music-marker'; marker.dataset.musicMarker = '';
  root.append(marker);
}
export function updateTimelinePosition(root: HTMLElement, project: Project, position: number) {
  const marker = root.querySelector<HTMLElement>('[data-music-marker]');
  if (marker) marker.style.left = `calc(7rem + (100% - 7rem) * ${Math.min(1, position / timelineLength(project))})`;
}
export function pitchShape(pitch: number, palette: Shape | 'mixed'): Shape {
  return palette === 'mixed' ? (['star', 'triangle', 'square'] as const)[((pitch % 12) + 12) % 3] : palette;
}
function symbol(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, radius: number) {
  ctx.beginPath();
  if (shape === 'square') ctx.rect(x - radius * .75, y - radius * .75, radius * 1.5, radius * 1.5);
  else {
    const sides = shape === 'star' ? 10 : 3;
    for (let i = 0; i < sides; i++) {
      const r = shape === 'star' && i % 2 ? radius * .45 : radius;
      const angle = -Math.PI / 2 + i * Math.PI * 2 / sides;
      const a = x + Math.cos(angle) * r, b = y + Math.sin(angle) * r;
      if (!i) ctx.moveTo(a, b); else ctx.lineTo(a, b);
    }
    ctx.closePath();
  }
}
export function drawVisual(canvas: HTMLCanvasElement, project: Project, events: PlaybackEvent[], position: number, palette: Shape | 'mixed', reduced: boolean) {
  const width = Math.max(250, canvas.clientWidth), laneHeight = 85, height = 35 + laneHeight * project.tracks.length;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const marker = Math.min(120, width * .28), scale = (width - marker - 20) / MUSIC_CONFIG.visualLookAhead;
  ctx.font = '11px system-ui'; ctx.fillStyle = '#656c69'; ctx.fillText('NOW', marker - 12, 19);
  ctx.strokeStyle = '#a32d32'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(marker, 25); ctx.lineTo(marker, height); ctx.stroke();
  project.tracks.forEach((track, index) => {
    const top = 35 + index * laneHeight;
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.fillStyle = '#656c69'; ctx.fillText(track.name, 8, top + 13);
    ctx.strokeStyle = '#d8dcd7'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, top + laneHeight - 1); ctx.lineTo(width, top + laneHeight - 1); ctx.stroke();
    for (const event of events) {
      if (event.trackId !== track.id) continue;
      const end = event.start + event.duration;
      if (event.start > position + MUSIC_CONFIG.visualLookAhead || end < position - MUSIC_CONFIG.visualFade) continue;
      const active = event.start <= position && position < end, ended = position >= end;
      // Reduced motion uses a stationary six-second sheet; only highlights change.
      const sheetStart = reduced ? Math.floor(position / MUSIC_CONFIG.visualLookAhead) * MUSIC_CONFIG.visualLookAhead : position;
      const rawX = marker + (event.start - sheetStart) * scale;
      const x = active && !reduced ? marker : Math.max(14, rawX);
      const tail = Math.max(x, marker + (end - sheetStart) * scale);
      const pitchClass = ((event.pitch % 12) + 12) % 12;
      const y = top + 48 - (pitchClass - 5.5) * 1.8;
      const color = `hsl(${pitchClass * 30 + 205} 48% 38%)`;
      const flash = active && position - event.start < .12;
      ctx.globalAlpha = ended ? Math.max(0, 1 - (position - end) / MUSIC_CONFIG.visualFade) : active ? 1 : .5;
      const style = instrumentStyles[track.instrument];
      ctx.shadowColor = color; ctx.shadowBlur = style.shadow; ctx.lineWidth = style.line; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(Math.min(width + 10, tail), y); ctx.stroke();
      symbol(ctx, pitchShape(event.pitch, palette), x, y, flash && !reduced ? 13 : 10);
      ctx.fillStyle = active ? color : '#f5f5f1'; ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#303734'; ctx.font = '10px system-ui'; ctx.fillText(noteName(event.pitch), x - 9, y + 22);
    }
  });
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
