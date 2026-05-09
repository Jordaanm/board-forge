// Rich-content surface element backed by Satori (issue #8 of
// issues--ui-surface.md). State: `{ x, y, w, h, html }`.
//
// `produceBitmap` scans the HTML for `<img src="...">` references and
// subscribes through `AssetService` for each unique ref. While any subscribed
// ref is still pending, `produceBitmap` returns null — the surface composes
// without our content this frame and recomposes when a callback flips it
// dirty. Once all refs resolve, the HTML is rewritten with the resolved
// `<img>` URLs (data URLs derived from the texture image), and the result is
// fed to `SatoriRenderer.render`.
//
// `SatoriRenderer` lazy-loads on the first render call — the heavy
// `satori` + `satori-html` modules are not in the initial client bundle.
// Subsequent surfaces / elements share the loaded module via the singleton.
//
// Bitmap cache key combines an HTML hash with the resolved-image-URL hashes
// and the requested size. The placeholder→resolved transition naturally
// flips the key (resolved URLs differ from missing ones) so the cache stays
// stable across reloads without explicit invalidation.

import { ElementComponent, type ElementBounds } from './ElementComponent';
import { elementBitmapCache, type Bitmap } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';
import { satoriRenderer, type SatoriRenderer } from './SatoriRenderer';
import type { SpawnContext } from '../EntityComponent';
import type * as THREE from 'three';

export interface RichState extends ElementBounds {
  html: string;
}

interface ImageSub {
  ref:    string;
  unsub:  () => void;
  status: 'pending' | 'ready';
  url:    string | null;  // resolved data URL once ready
}

export class RichElement extends ElementComponent<RichState> {
  static typeId:   string            = 'rich-element';
  static requires: readonly string[] = [];

  // Injectable for tests — defaults to the production singleton.
  renderer: SatoriRenderer = satoriRenderer;

  private subs: Map<string, ImageSub> = new Map();
  private inflight: Promise<void> | null = null;
  private inflightKey: string | null = null;

  onSpawn(ctx: SpawnContext): void {
    super.onSpawn(ctx);
    this.refreshSubscriptions();
  }

  onDespawn(ctx: SpawnContext): void {
    this.unsubscribeAll();
    super.onDespawn(ctx);
  }

  onPropertiesChanged(changed: Partial<RichState>): void {
    if (changed.html !== undefined) this.refreshSubscriptions();
    super.onPropertiesChanged(changed);
  }

  produceBitmap(): Bitmap | null {
    const { w, h, html } = this.state;
    if (w <= 0 || h <= 0) return null;
    if (this.anyPending()) return null;

    const urls = this.resolvedUrlMap();
    const key  = cacheKey(html, urls, w, h);
    const hit  = elementBitmapCache.get(key);
    if (hit) return hit;

    // Kick off async render if not already in flight for this exact key.
    if (this.inflightKey !== key) this.startRender(html, urls, w, h, key);
    return null;
  }

  private anyPending(): boolean {
    for (const s of this.subs.values()) if (s.status === 'pending') return true;
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
      // Drop result if state changed underneath us — a fresher render has
      // already been queued and our key no longer matches.
      if (this.inflightKey !== key) return;
      elementBitmapCache.set(key, bmp);
      this.inflight    = null;
      this.inflightKey = null;
      this.markParentSurfaceDirty();
    }).catch((err) => {
      // Surface render failures bubble through console.error so authors see
      // why their HTML didn't draw. The element draws nothing this frame and
      // will retry on the next state mutation.
      if (typeof console !== 'undefined') console.error('[RichElement] render failed:', err);
      this.inflight    = null;
      this.inflightKey = null;
    });
  }

  private refreshSubscriptions(): void {
    const wanted = new Set(extractImageRefs(this.state.html));
    // Drop subs that are no longer referenced.
    for (const [ref, sub] of [...this.subs]) {
      if (!wanted.has(ref)) {
        sub.unsub();
        this.subs.delete(ref);
      }
    }
    // Add subs for new refs.
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
        // Cache key changes when an image flips from pending → ready, so any
        // in-flight render against the old key is now stale.
        this.inflightKey = null;
        this.markParentSurfaceDirty();
      });
    }
  }

  private unsubscribeAll(): void {
    for (const sub of this.subs.values()) sub.unsub();
    this.subs.clear();
    this.inflight    = null;
    this.inflightKey = null;
  }
}

// Extracts the `src` attributes of every `<img>` tag in the HTML. Tolerates
// single or double quotes around the value. Whitespace inside the tag is
// permitted; non-img tags are ignored.
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

// Rewrites every `<img src="ref">` in the HTML by replacing `ref` with the
// resolved URL when present. Refs not in the map are left untouched (Satori
// will simply fail to load them, matching the "missing asset" affordance
// elsewhere in the app).
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

function cacheKey(html: string, urls: Map<string, string>, w: number, h: number): string {
  const hHash = hashString(html);
  const parts: string[] = [];
  for (const [ref, url] of urls) parts.push(`${ref}=${hashString(url)}`);
  parts.sort();
  return `rich:${hHash}|${w}x${h}|${parts.join('|')}`;
}

// Tiny non-cryptographic string hash. Stable across runs; collisions are not
// catastrophic — a collision merely returns a stale bitmap, which the next
// state change naturally re-renders.
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// Converts a resolved THREE.Texture into a data URL the rasteriser can embed.
// Returns null when the underlying image isn't drawable yet (e.g. the
// 1×1 magenta placeholder from AssetService) so callers know to wait.
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
