import { PLAY_CONFIG } from './config';
import type { Particle, Pointer, Sample, Scene } from './types';
import type { TrailParticle } from './trails';

export const SAMPLE_TEXT = 'Stay curious.';

/** Rendering owns layout and pixels; it never changes velocities or reads input. */
export class PlayRenderer {
  private context: CanvasRenderingContext2D;
  private ratio = 1;
  private font = '';
  private ink: string;
  private accent: string;
  private serif: string;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    this.context = context;
    const styles = getComputedStyle(canvas);
    this.ink = styles.getPropertyValue('--ink').trim() || '#171a19';
    this.accent = styles.getPropertyValue('--accent').trim() || '#2455a6';
    this.serif = styles.getPropertyValue('--serif').trim() || 'Georgia, serif';
  }

  layout(sample: Sample, image?: HTMLImageElement): Scene {
    const box = this.canvas.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    this.ratio = Math.min(window.devicePixelRatio || 1, PLAY_CONFIG.pixelRatio);
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
    this.context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    const particles: Particle[] = [];
    const add = (x: number, y: number, w: number, h: number, source: Partial<Particle>) => {
      if (particles.length < PLAY_CONFIG.maxParticles) {
        particles.push({ x, y, homeX: x, homeY: y, vx: 0, vy: 0, width: w, height: h, ...source });
      }
    };

    if (sample === 'text' || !image) {
      const size = Math.min(76, width / 7.8);
      this.font = `${size}px ${this.serif}`;
      this.context.font = this.font;
      const advances = Array.from(SAMPLE_TEXT, glyph => this.context.measureText(glyph).width);
      let x = (width - advances.reduce((sum, advance) => sum + advance, 0)) / 2;
      Array.from(SAMPLE_TEXT).forEach((glyph, i) => {
        const advance = advances[i];
        if (glyph !== ' ') add(x + advance / 2, height / 2, advance, size, { glyph });
        x += advance;
      });
    } else {
      const columns = sample === 'mark' ? 6 : 8;
      const rows = sample === 'mark' ? 6 : 4;
      const w = Math.min(width * 0.78, sample === 'mark' ? 180 : 540);
      const h = w * image.naturalHeight / image.naturalWidth;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          add((width - w) / 2 + (column + 0.5) * w / columns,
            (height - h) / 2 + (row + 0.5) * h / rows, w / columns, h / rows, {
              sx: column * image.naturalWidth / columns,
              sy: row * image.naturalHeight / rows,
              sw: image.naturalWidth / columns,
              sh: image.naturalHeight / rows,
            });
        }
      }
    }
    return { particles, width, height, scattered: false, grabbed: false };
  }

  draw(scene: Scene, image: HTMLImageElement | undefined, pointer: Pointer, radius: number,
    trails: readonly TrailParticle[] = []) {
    const ctx = this.context;
    ctx.clearRect(0, 0, scene.width, scene.height);
    ctx.save();
    ctx.fillStyle = this.accent;
    for (const particle of trails) {
      const progress = Math.min(1, particle.age / particle.lifetime);
      ctx.globalAlpha = 0.65 * (1 - progress * progress * (3 - 2 * progress));
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (1 - progress * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = this.ink;
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of scene.particles) {
      if (p.glyph) ctx.fillText(p.glyph, p.x, p.y);
      else if (image) {
        ctx.drawImage(image, p.sx!, p.sy!, p.sw!, p.sh!,
          p.x - p.width / 2, p.y - p.height / 2, p.width + 0.15, p.height + 0.15);
      }
    }
    if (pointer.active) {
      ctx.save();
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pointer.x - 4, pointer.y);
      ctx.lineTo(pointer.x + 4, pointer.y);
      ctx.moveTo(pointer.x, pointer.y - 4);
      ctx.lineTo(pointer.x, pointer.y + 4);
      ctx.stroke();
      ctx.restore();
    }
  }
}
