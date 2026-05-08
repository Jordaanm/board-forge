// Cheap shape-drawing surface element (issue #2 of issues--ui-surface.md).
// Draws a filled/stroked rect or ellipse via Canvas2D. Used as the simplest
// proof of the surface compose pipeline; no asset subscription, no Satori.
//
// State carries layout (`x, y, w, h`) plus shape kind and styling. Bitmap
// output is cached in `elementBitmapCache` keyed on the styled-content hash
// + size so repeated produceBitmap calls during compose are free.

import { ElementComponent, type ElementBounds } from './ElementComponent';
import { elementBitmapCache, type Bitmap } from './ElementBitmapCache';

export type ShapeKind = 'rect' | 'circle';

export interface ShapeState extends ElementBounds {
  kind:         ShapeKind;
  fill?:        string;
  stroke?:      string;
  strokeWidth?: number;
  radius?:      number;
}

export class ShapeElement extends ElementComponent<ShapeState> {
  static typeId:   string            = 'shape-element';
  static requires: readonly string[] = [];

  produceBitmap(): Bitmap | null {
    const { kind, w, h, fill, stroke, strokeWidth, radius } = this.state;
    if (w <= 0 || h <= 0) return null;
    const key = cacheKey(kind, w, h, fill, stroke, strokeWidth, radius);
    const hit = elementBitmapCache.get(key);
    if (hit) return hit;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawShape(ctx, this.state);
    elementBitmapCache.set(key, canvas);
    return canvas;
  }
}

function cacheKey(
  kind: ShapeKind,
  w: number, h: number,
  fill: string | undefined,
  stroke: string | undefined,
  strokeWidth: number | undefined,
  radius: number | undefined,
): string {
  return `shape:${kind}|${w}x${h}|f=${fill ?? ''}|s=${stroke ?? ''}|sw=${strokeWidth ?? ''}|r=${radius ?? ''}`;
}

function drawShape(ctx: CanvasRenderingContext2D, s: ShapeState): void {
  const { kind, w, h, fill, stroke, strokeWidth, radius } = s;
  const sw = strokeWidth ?? 0;
  ctx.clearRect(0, 0, w, h);

  if (kind === 'rect') {
    drawRect(ctx, w, h, fill, stroke, sw, radius ?? 0);
  } else if (kind === 'circle') {
    drawEllipse(ctx, w, h, fill, stroke, sw);
  }
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  fill: string | undefined,
  stroke: string | undefined,
  sw: number,
  r: number,
): void {
  const inset = sw / 2;
  const x0 = inset, y0 = inset;
  const x1 = w - inset, y1 = h - inset;
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));

  ctx.beginPath();
  if (rr > 0) {
    ctx.moveTo(x0 + rr, y0);
    ctx.lineTo(x1 - rr, y0);
    ctx.arcTo(x1, y0, x1, y0 + rr, rr);
    ctx.lineTo(x1, y1 - rr);
    ctx.arcTo(x1, y1, x1 - rr, y1, rr);
    ctx.lineTo(x0 + rr, y1);
    ctx.arcTo(x0, y1, x0, y1 - rr, rr);
    ctx.lineTo(x0, y0 + rr);
    ctx.arcTo(x0, y0, x0 + rr, y0, rr);
    ctx.closePath();
  } else {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && sw > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = sw;
    ctx.stroke();
  }
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  fill: string | undefined,
  stroke: string | undefined,
  sw: number,
): void {
  const cx = w / 2, cy = h / 2;
  const rx = Math.max(0, w / 2 - sw / 2);
  const ry = Math.max(0, h / 2 - sw / 2);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && sw > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = sw;
    ctx.stroke();
  }
}
