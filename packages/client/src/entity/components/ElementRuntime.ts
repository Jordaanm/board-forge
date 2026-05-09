// ElementRuntime is the imperative side of a SurfaceElement: per-kind logic
// (Canvas2D drawing, asset subscriptions, async Satori renders) that used to
// live on element-entity components. Now owned by SurfaceComponent in a
// `Map<elementId, ElementRuntime>` keyed off the element's id.
//
// Lifecycle mirrors entity components but driven by SurfaceComponent's diff:
//   - `mount(state)`: called when an element id first appears in the array.
//   - `update(prev, next)`: called when a same-`kind` element's state changes.
//     Different-`kind` mutations are translated to `unmount` + fresh `mount`
//     by the orchestrator.
//   - `unmount()`: called when the element id is removed from the array, or
//     when a kind change forces a runtime swap.
//   - `produceBitmap()`: returns the rasterised bitmap for the current state,
//     or null when the runtime can't draw yet (no asset, async render
//     pending, no canvas backend).

import { elementBitmapCache, type Bitmap } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';
import { satoriRenderer, type SatoriRenderer } from './SatoriRenderer';
import {
  type SurfaceElement,
  type ShapeElement,
  type ImageElement,
  type RichElement,
} from './SurfaceElement';
import type * as THREE from 'three';

export interface ElementRuntime<T extends SurfaceElement = SurfaceElement> {
  mount(state: T): void;
  update(prev: T, next: T): void;
  unmount(): void;
  produceBitmap(): Bitmap | null;
}

// Pluggable so a surface that wants to share a marker can mark itself dirty
// when an async resource (asset, Satori render) resolves.
export interface RuntimeContext {
  markDirty: () => void;
}

// ── ShapeRuntime ────────────────────────────────────────────────────────────
// Pure Canvas2D — no async resources. produceBitmap caches by content key.

export class ShapeRuntime implements ElementRuntime<ShapeElement> {
  private state: ShapeElement | null = null;

  mount(state: ShapeElement): void {
    this.state = state;
  }

  update(_prev: ShapeElement, next: ShapeElement): void {
    this.state = next;
  }

  unmount(): void {
    this.state = null;
  }

  produceBitmap(): Bitmap | null {
    const s = this.state;
    if (!s) return null;
    if (s.w <= 0 || s.h <= 0) return null;
    const key = shapeCacheKey(s);
    const hit = elementBitmapCache.get(key);
    if (hit) return hit;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(s.w));
    canvas.height = Math.max(1, Math.round(s.h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawShape(ctx, s);
    elementBitmapCache.set(key, canvas);
    return canvas;
  }
}

function shapeCacheKey(s: ShapeElement): string {
  return `shape:${s.shape}|${s.w}x${s.h}|f=${s.fill ?? ''}|s=${s.stroke ?? ''}|sw=${s.strokeWidth ?? ''}|r=${s.radius ?? ''}`;
}

function drawShape(ctx: CanvasRenderingContext2D, s: ShapeElement): void {
  const { shape, w, h, fill, stroke, strokeWidth, radius } = s;
  const sw = strokeWidth ?? 0;
  ctx.clearRect(0, 0, w, h);
  if (shape === 'rect')   drawRect   (ctx, w, h, fill, stroke, sw, radius ?? 0);
  if (shape === 'circle') drawEllipse(ctx, w, h, fill, stroke, sw);
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

// ── ImageRuntime ────────────────────────────────────────────────────────────
// Subscribes through AssetService for `textureRef`. Re-subs on ref changes.

export class ImageRuntime implements ElementRuntime<ImageElement> {
  private state:     ImageElement     | null = null;
  private latestTex: THREE.Texture    | null = null;
  private unsub:     (() => void)     | null = null;
  private readonly ctx: RuntimeContext;

  constructor(ctx: RuntimeContext) {
    this.ctx = ctx;
  }

  mount(state: ImageElement): void {
    this.state = state;
    this.subscribe();
  }

  update(prev: ImageElement, next: ImageElement): void {
    this.state = next;
    if (prev.textureRef !== next.textureRef) {
      this.unsubscribe();
      this.subscribe();
    }
  }

  unmount(): void {
    this.unsubscribe();
    this.state = null;
  }

  produceBitmap(): Bitmap | null {
    const s = this.state;
    if (!s) return null;
    if (s.w <= 0 || s.h <= 0) return null;
    const tex = this.latestTex;
    if (!tex) return null;
    const source = drawableSource(tex);
    if (!source) return null;

    const key = `image:${tex.uuid}|${s.w}x${s.h}|${s.fit}`;
    const hit = elementBitmapCache.get(key);
    if (hit) return hit;
    if (typeof document === 'undefined') return null;

    const canvas  = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(s.w));
    canvas.height = Math.max(1, Math.round(s.h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawWithFit(ctx, source, s.w, s.h, s.fit);
    elementBitmapCache.set(key, canvas);
    return canvas;
  }

  private subscribe(): void {
    const ref = this.state?.textureRef ?? '';
    if (!ref) {
      this.latestTex = null;
      return;
    }
    this.unsub = assetService.subscribe(ref, 'image', (tex) => {
      this.latestTex = tex;
      this.ctx.markDirty();
    });
  }

  private unsubscribe(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.latestTex = null;
  }
}

function drawableSource(tex: THREE.Texture): CanvasImageSource | null {
  const img = tex.image as unknown;
  if (!img) return null;
  if (typeof HTMLImageElement  !== 'undefined' && img instanceof HTMLImageElement)  return img;
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return img;
  if (typeof ImageBitmap       !== 'undefined' && img instanceof ImageBitmap)       return img;
  if (typeof OffscreenCanvas   !== 'undefined' && img instanceof OffscreenCanvas)   return img;
  return null;
}

function drawWithFit(
  ctx:  CanvasRenderingContext2D,
  source: CanvasImageSource,
  w: number,
  h: number,
  fit: ImageElement['fit'],
): void {
  const sw = sourceWidth(source);
  const sh = sourceHeight(source);

  if (fit === 'stretch' || sw <= 0 || sh <= 0) {
    ctx.drawImage(source, 0, 0, w, h);
    return;
  }
  if (fit === 'none') {
    ctx.drawImage(source, 0, 0);
    return;
  }
  const scale = fit === 'fit'
    ? Math.min(w / sw, h / sh)
    : Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(source, dx, dy, dw, dh);
}

function sourceWidth(s: CanvasImageSource): number {
  const any = s as { naturalWidth?: number; width?: number };
  return any.naturalWidth ?? any.width ?? 0;
}

function sourceHeight(s: CanvasImageSource): number {
  const any = s as { naturalHeight?: number; height?: number };
  return any.naturalHeight ?? any.height ?? 0;
}

// ── RichRuntime ─────────────────────────────────────────────────────────────
// HTML → Satori, with per-`<img src>` asset subscriptions for embed urls.

interface ImageSub {
  ref:    string;
  unsub:  () => void;
  status: 'pending' | 'ready';
  url:    string | null;
}

export class RichRuntime implements ElementRuntime<RichElement> {
  // Injectable for tests — defaults to the production singleton.
  renderer: SatoriRenderer = satoriRenderer;

  private state: RichElement | null = null;
  private subs:  Map<string, ImageSub> = new Map();
  private inflight:    Promise<void> | null = null;
  private inflightKey: string         | null = null;
  private readonly ctx: RuntimeContext;

  constructor(ctx: RuntimeContext) {
    this.ctx = ctx;
  }

  mount(state: RichElement): void {
    this.state = state;
    this.refreshSubscriptions();
  }

  update(prev: RichElement, next: RichElement): void {
    this.state = next;
    if (prev.html !== next.html) this.refreshSubscriptions();
  }

  unmount(): void {
    for (const sub of this.subs.values()) sub.unsub();
    this.subs.clear();
    this.inflight    = null;
    this.inflightKey = null;
    this.state       = null;
  }

  produceBitmap(): Bitmap | null {
    const s = this.state;
    if (!s) return null;
    if (s.w <= 0 || s.h <= 0) return null;
    if (this.anyPending()) return null;

    const urls = this.resolvedUrlMap();
    const key  = richCacheKey(s.html, urls, s.w, s.h);
    const hit  = elementBitmapCache.get(key);
    if (hit) return hit;

    if (this.inflightKey !== key) this.startRender(s.html, urls, s.w, s.h, key);
    return null;
  }

  private anyPending(): boolean {
    for (const sub of this.subs.values()) if (sub.status === 'pending') return true;
    return false;
  }

  private resolvedUrlMap(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [ref, sub] of this.subs) if (sub.url) out.set(ref, sub.url);
    return out;
  }

  private startRender(html: string, urls: Map<string, string>, w: number, h: number, key: string): void {
    this.inflightKey = key;
    const subbed = substituteImageUrls(html, urls);
    const p = this.renderer.render(subbed, w, h);
    this.inflight = p.then((bmp) => {
      if (this.inflightKey !== key) return;
      elementBitmapCache.set(key, bmp);
      this.inflight    = null;
      this.inflightKey = null;
      this.ctx.markDirty();
    }).catch((err) => {
      if (typeof console !== 'undefined') console.error('[RichRuntime] render failed:', err);
      this.inflight    = null;
      this.inflightKey = null;
    });
  }

  private refreshSubscriptions(): void {
    const wanted = new Set(extractImageRefs(this.state?.html ?? ''));
    for (const [ref, sub] of [...this.subs]) {
      if (!wanted.has(ref)) {
        sub.unsub();
        this.subs.delete(ref);
      }
    }
    for (const ref of wanted) {
      if (this.subs.has(ref)) continue;
      const entry: ImageSub = { ref, unsub: () => {}, status: 'pending', url: null };
      this.subs.set(ref, entry);
      entry.unsub = assetService.subscribe(ref, 'image', (tex) => {
        const url = textureToDataUrl(tex);
        if (!url) {
          entry.status = 'pending';
          entry.url    = null;
          return;
        }
        entry.status = 'ready';
        entry.url    = url;
        this.inflightKey = null;
        this.ctx.markDirty();
      });
    }
  }
}

export function extractImageRefs(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1] ?? m[2];
    if (src) out.push(src);
  }
  return out;
}

export function substituteImageUrls(html: string, urls: Map<string, string>): string {
  if (urls.size === 0) return html;
  return html.replace(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (match, dq, sq) => {
    const ref = dq ?? sq;
    const replacement = urls.get(ref);
    if (!replacement) return match;
    const quote = dq !== undefined ? '"' : "'";
    return match.replace(`${quote}${ref}${quote}`, `${quote}${replacement}${quote}`);
  });
}

function richCacheKey(html: string, urls: Map<string, string>, w: number, h: number): string {
  const hHash = hashString(html);
  const parts: string[] = [];
  for (const [ref, url] of urls) parts.push(`${ref}=${hashString(url)}`);
  parts.sort();
  return `rich:${hHash}|${w}x${h}|${parts.join('|')}`;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function textureToDataUrl(tex: THREE.Texture): string | null {
  const img = tex.image as unknown;
  if (!img) return null;
  if (typeof document === 'undefined') return null;

  const drawable = drawableImage(img);
  if (!drawable) return null;
  const w = drawable.width;
  const h = drawable.height;
  if (w <= 0 || h <= 0) return null;

  try {
    const c = document.createElement('canvas');
    c.width  = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(drawable as CanvasImageSource, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

interface DrawableLike { width: number; height: number; }

function drawableImage(img: unknown): DrawableLike | null {
  if (typeof HTMLImageElement  !== 'undefined' && img instanceof HTMLImageElement) {
    const naturalW = (img as HTMLImageElement).naturalWidth;
    const naturalH = (img as HTMLImageElement).naturalHeight;
    return { width: naturalW || img.width, height: naturalH || img.height };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return img;
  if (typeof ImageBitmap       !== 'undefined' && img instanceof ImageBitmap)       return img;
  if (typeof OffscreenCanvas   !== 'undefined' && img instanceof OffscreenCanvas)   return img;
  return null;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function makeRuntime(element: SurfaceElement, ctx: RuntimeContext): ElementRuntime {
  switch (element.kind) {
    case 'shape': return new ShapeRuntime();
    case 'image': return new ImageRuntime(ctx);
    case 'rich':  return new RichRuntime(ctx);
  }
}
