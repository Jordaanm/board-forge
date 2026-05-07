import * as THREE from 'three';

// Single funnel for asset loads. Issue #1 of issues--asset-registry.md.
//
// `subscribe(ref, type, listener)` returns the current cached state to the
// listener immediately (placeholder until the real asset arrives) and again on
// every transition. Internal cache dedups concurrent + repeat fetches by ref.
// Loader is injected via constructor so tests can drive it deterministically.
//
// Slice 1 covers `image` only — slug resolution, model + audio loaders, and
// preload arrive in subsequent slices.

export type AssetType   = 'image' | 'model' | 'sound';
export type AssetStatus = 'pending' | 'loaded' | 'broken';

export type ImageLoader = (url: string) => Promise<THREE.Texture>;

const defaultImageLoader: ImageLoader = (url) => {
  if (typeof Image === 'undefined') {
    return Promise.reject(new Error('no DOM available for image load'));
  }
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => resolve(tex),
      undefined,
      () => reject(new Error(`failed to load image: ${url}`)),
    );
  });
};

let placeholderImage: THREE.Texture | null = null;

export function getImagePlaceholder(): THREE.Texture {
  if (placeholderImage) return placeholderImage;
  const data = new Uint8Array([255, 0, 255, 255]);
  const tex  = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  placeholderImage = tex;
  return tex;
}

type ImageListener = (texture: THREE.Texture, status: AssetStatus) => void;

interface ImageEntry {
  status:      AssetStatus;
  texture:     THREE.Texture;
  listeners:   Set<ImageListener>;
  loadPromise: Promise<THREE.Texture>;
}

export interface AssetServiceOptions {
  imageLoader?: ImageLoader;
}

export class AssetService {
  private images      = new Map<string, ImageEntry>();
  private imageLoader: ImageLoader;

  constructor(opts: AssetServiceOptions = {}) {
    this.imageLoader = opts.imageLoader ?? defaultImageLoader;
  }

  // Promise-based accessor — resolves with the real asset on success or with
  // the placeholder on failure. Never rejects, so callers don't need a
  // try/catch around resolve.
  resolve(ref: string, type: AssetType): Promise<THREE.Texture> {
    if (type !== 'image') {
      return Promise.reject(new Error(`AssetService: unsupported type "${type}"`));
    }
    return this.ensureImage(ref).loadPromise;
  }

  // Fires `listener` immediately with the current state, then again on every
  // transition (`pending` → `loaded`, `pending` → `broken`, post-invalidate).
  // Same ref subscribed twice triggers exactly one fetch.
  subscribe(ref: string, type: AssetType, listener: ImageListener): () => void {
    if (type !== 'image') {
      throw new Error(`AssetService: unsupported type "${type}"`);
    }
    const entry = this.ensureImage(ref);
    entry.listeners.add(listener);
    listener(entry.texture, entry.status);
    return () => { entry.listeners.delete(listener); };
  }

  // Drops cached state for `ref` and re-fetches; existing listeners are
  // re-notified through the new entry. Used by manager UI on URL edit.
  invalidate(ref: string): void {
    const entry = this.images.get(ref);
    if (!entry) return;
    entry.status  = 'pending';
    entry.texture = getImagePlaceholder();
    for (const l of entry.listeners) l(entry.texture, 'pending');
    this.startImageLoad(ref, entry);
  }

  status(ref: string, type: AssetType): AssetStatus | null {
    if (type !== 'image') return null;
    return this.images.get(ref)?.status ?? null;
  }

  private ensureImage(ref: string): ImageEntry {
    const existing = this.images.get(ref);
    if (existing) return existing;
    const entry: ImageEntry = {
      status:      'pending',
      texture:     getImagePlaceholder(),
      listeners:   new Set(),
      loadPromise: Promise.resolve(getImagePlaceholder()),
    };
    this.images.set(ref, entry);
    this.startImageLoad(ref, entry);
    return entry;
  }

  private startImageLoad(ref: string, entry: ImageEntry): void {
    entry.loadPromise = this.imageLoader(ref).then(
      (tex) => {
        entry.status  = 'loaded';
        entry.texture = tex;
        for (const l of entry.listeners) l(tex, 'loaded');
        return tex;
      },
      () => {
        entry.status = 'broken';
        for (const l of entry.listeners) l(entry.texture, 'broken');
        return entry.texture;
      },
    );
  }
}

export const assetService = new AssetService();
