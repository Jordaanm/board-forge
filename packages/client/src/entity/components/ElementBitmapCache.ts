// Process-global LRU cache mapping `(elementType, content-hash, w, h)` keys
// to rendered bitmaps (issue #2 of issues--ui-surface.md). Element components
// derive their own keys; the cache stays implementation-agnostic.
//
// Keys are opaque strings — caller-derived. LRU bump on read; eviction at the
// soft cap. No explicit per-element invalidation: when an element's content
// changes, the new key won't match the old, the old entry sits at the LRU
// tail and falls out naturally.

const DEFAULT_CAP = 256;

export type Bitmap = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

export class ElementBitmapCache {
  private map = new Map<string, Bitmap>();
  private cap: number;

  constructor(cap: number = DEFAULT_CAP) {
    this.cap = cap;
  }

  get(key: string): Bitmap | undefined {
    const v = this.map.get(key);
    if (!v) return undefined;
    // LRU bump.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, bitmap: Bitmap): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, bitmap);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (!oldest) break;
      this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export const elementBitmapCache = new ElementBitmapCache();
