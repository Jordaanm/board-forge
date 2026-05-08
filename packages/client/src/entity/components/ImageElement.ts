// Image-asset surface element (issue #3 of issues--ui-surface.md).
//
// Subscribes through `AssetService` for its `textureRef`. The listener
// stashes the resolved THREE.Texture and flips the parent surface dirty so
// the next compose draws the new image. `produceBitmap` rasterises the
// resolved source onto an offscreen canvas at the element's `(w, h)`
// according to `fit` ('fit' | 'cover' | 'stretch' | 'none').
//
// Cache key includes `tex.uuid` — every load transition (placeholder →
// resolved) yields a new texture instance with a new uuid, so the cache
// flips naturally without explicit invalidation.

import { ElementComponent, type ElementBounds } from './ElementComponent';
import { elementBitmapCache, type Bitmap } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';
import type { SpawnContext } from '../EntityComponent';
import type * as THREE from 'three';

export type ImageFit = 'fit' | 'cover' | 'stretch' | 'none';

export interface ImageState extends ElementBounds {
  textureRef: string;
  fit:        ImageFit;
}

export class ImageElement extends ElementComponent<ImageState> {
  static typeId:   string            = 'image-element';
  static requires: readonly string[] = [];

  private latestTex: THREE.Texture | null = null;
  private unsub:     (() => void) | null  = null;

  onSpawn(ctx: SpawnContext): void {
    super.onSpawn(ctx);
    this.subscribeToAsset();
  }

  onDespawn(ctx: SpawnContext): void {
    this.unsubscribeFromAsset();
    super.onDespawn(ctx);
  }

  onPropertiesChanged(changed: Partial<ImageState>): void {
    if (changed.textureRef !== undefined) {
      this.unsubscribeFromAsset();
      this.subscribeToAsset();
    }
    super.onPropertiesChanged(changed);
  }

  produceBitmap(): Bitmap | null {
    const { w, h, fit } = this.state;
    if (w <= 0 || h <= 0) return null;
    const tex = this.latestTex;
    if (!tex) return null;
    const source = drawableSource(tex);
    if (!source) return null;

    const key = `image:${tex.uuid}|${w}x${h}|${fit}`;
    const hit = elementBitmapCache.get(key);
    if (hit) return hit;
    if (typeof document === 'undefined') return null;

    const canvas  = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawWithFit(ctx, source, w, h, fit);
    elementBitmapCache.set(key, canvas);
    return canvas;
  }

  private subscribeToAsset(): void {
    const ref = this.state.textureRef;
    if (!ref) {
      this.latestTex = null;
      return;
    }
    this.unsub = assetService.subscribe(ref, 'image', (tex) => {
      this.latestTex = tex;
      this.markParentSurfaceDirty();
    });
  }

  private unsubscribeFromAsset(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.latestTex = null;
  }
}

// Returns a CanvasImageSource if the texture's `image` field is one. The
// AssetService placeholder is a DataTexture whose `.image` is a typed-data
// blob (not drawable) — return null in that case so the element renders
// nothing until the real image resolves.
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
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  w: number,
  h: number,
  fit: ImageFit,
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
    : Math.max(w / sw, h / sh); // cover
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
