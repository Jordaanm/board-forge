// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Entity } from '../Entity';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';
import { SurfaceComponent } from './SurfaceComponent';
import { ImageElement } from './ImageElement';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { elementBitmapCache } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';

interface DrawCall { source: unknown; x: number; y: number; w?: number; h?: number; }

function installRecordingCtx(): { calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const ctx: any = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect: () => {}, fillRect:  () => {}, strokeRect: () => {}, rect: () => {},
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arcTo:     () => {}, arc: () => {}, ellipse: () => {},
    fill: () => {}, stroke: () => {},
    drawImage: (source: unknown, x: number, y: number, w?: number, h?: number) => {
      calls.push({ source, x, y, w, h });
    },
  };
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type === '2d') return ctx;
    return null;
  } as any;
  return { calls };
}

function makeFakeImage(w: number, h: number): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth',  { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
  Object.defineProperty(img, 'width',  { value: w, configurable: true });
  Object.defineProperty(img, 'height', { value: h, configurable: true });
  return img;
}

function makeFakeTexture(w: number, h: number): THREE.Texture {
  const tex = new THREE.Texture();
  tex.image = makeFakeImage(w, h);
  return tex;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
  vi.restoreAllMocks();
});

function spawnImageElement(state: Partial<ImageElement['state']> = {}): {
  scene:     SceneImpl;
  ctx:       SpawnContext;
  parent:    Entity;
  surface:   SurfaceComponent;
  child:     Entity;
  el:        ImageElement;
  recording: { calls: DrawCall[] };
} {
  const recording = installRecordingCtx();
  const scene = new SceneImpl();
  const ctx: SpawnContext = { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };

  const parent = new Entity({ id: 'p-1', type: 'sticker', name: 'Sticker' });
  const transform = new TransformComponent();
  transform.fromJSON({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  parent.attachComponent(transform);
  const mesh = new MeshComponent();
  mesh.fromJSON({ meshRef: 'prim:plane', textureRefs: { default: '' }, tint: '#ffffff', size: [1, 0.01, 1] });
  parent.attachComponent(mesh);
  const surface = new SurfaceComponent();
  surface.fromJSON({ canvasSize: [256, 256] });
  parent.attachComponent(surface);
  scene.add(parent);
  transform.onSpawn(ctx);
  mesh.onSpawn(ctx);
  surface.onSpawn(ctx);

  const child = new Entity({ id: 'c-1', type: 'image-element', name: 'Image', parentId: parent.id });
  parent.children.push(child.id);
  const el = new ImageElement();
  el.fromJSON({
    x: 0, y: 0, w: 100, h: 100,
    textureRef: 'base:tex/foo',
    fit: 'fit',
    ...state,
  });
  child.attachComponent(el);
  scene.add(child);
  el.onSpawn(ctx);

  return { scene, ctx, parent, surface, child, el, recording };
}

describe('ImageElement — registration', () => {
  test('static metadata', () => {
    expect(ImageElement.typeId).toBe('image-element');
    expect(ImageElement.requires).toEqual([]);
  });
});

describe('ImageElement — AssetService bridge', () => {
  test('subscribes through AssetService on spawn with type "image" + the configured ref', () => {
    const subscribeSpy = vi.spyOn(assetService, 'subscribe');
    spawnImageElement({ textureRef: 'base:tex/portrait' });
    expect(subscribeSpy).toHaveBeenCalledWith('base:tex/portrait', 'image', expect.any(Function));
  });

  test('unsubscribes on onDespawn', () => {
    const unsub = vi.fn();
    vi.spyOn(assetService, 'subscribe').mockReturnValue(unsub);
    const { el, ctx } = spawnImageElement();
    el.onDespawn(ctx);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  test('textureRef change unsubs the old ref and subscribes to the new one', () => {
    const calls: Array<{ ref: string; unsub: () => void }> = [];
    vi.spyOn(assetService, 'subscribe').mockImplementation((ref: string) => {
      const u = vi.fn();
      calls.push({ ref, unsub: u });
      return u;
    });

    const { el } = spawnImageElement({ textureRef: 'base:tex/a' });
    expect(calls.length).toBe(1);
    expect(calls[0].ref).toBe('base:tex/a');

    el.setState({ textureRef: 'base:tex/b' });
    expect(calls[0].unsub).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(2);
    expect(calls[1].ref).toBe('base:tex/b');
  });

  test('listener fires from AssetService → marks parent surface dirty', () => {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });

    const { surface } = spawnImageElement();
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);

    captured!(makeFakeTexture(64, 64));
    expect(surfaceRenderQueue.size()).toBe(1);
    expect(surface.canvas).not.toBeNull();
  });
});

describe('ImageElement — produceBitmap fit modes', () => {
  function setupResolved(w: number, h: number, sourceW: number, sourceH: number, fit: ImageElement['state']['fit']) {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });
    const { el, recording } = spawnImageElement({ w, h, fit, textureRef: 'base:tex/a' });
    captured!(makeFakeTexture(sourceW, sourceH));
    el.produceBitmap();
    return recording;
  }

  test('stretch: drawImage(source, 0, 0, w, h)', () => {
    const rec = setupResolved(100, 50, 200, 200, 'stretch');
    const last = rec.calls[rec.calls.length - 1];
    expect(last.x).toBe(0);
    expect(last.y).toBe(0);
    expect(last.w).toBe(100);
    expect(last.h).toBe(50);
  });

  test('none: drawImage at native size, top-left', () => {
    const rec = setupResolved(100, 100, 64, 64, 'none');
    const last = rec.calls[rec.calls.length - 1];
    expect(last.x).toBe(0);
    expect(last.y).toBe(0);
    expect(last.w).toBeUndefined();
  });

  test('fit: preserves aspect with letterbox (centered, scaled to fit inside)', () => {
    // 200x100 source into 100x100 box → scale 0.5, dw=100, dh=50, dx=0, dy=25.
    const rec = setupResolved(100, 100, 200, 100, 'fit');
    const last = rec.calls[rec.calls.length - 1];
    expect(last.w).toBe(100);
    expect(last.h).toBe(50);
    expect(last.x).toBe(0);
    expect(last.y).toBe(25);
  });

  test('cover: preserves aspect with crop (centered, scaled to fill)', () => {
    // 200x100 source into 100x100 box → scale 1.0, dw=200, dh=100, dx=-50, dy=0.
    const rec = setupResolved(100, 100, 200, 100, 'cover');
    const last = rec.calls[rec.calls.length - 1];
    expect(last.w).toBe(200);
    expect(last.h).toBe(100);
    expect(last.x).toBe(-50);
    expect(last.y).toBe(0);
  });

  test('returns null until the asset resolves (no drawable source on placeholder)', () => {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });
    const { el } = spawnImageElement();
    // Simulate placeholder — DataTexture with non-drawable image.
    const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    captured!(placeholder);
    expect(el.produceBitmap()).toBeNull();
  });

  test('cache key flips on texture identity (placeholder → resolved)', () => {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });
    const { el } = spawnImageElement();

    const t1 = makeFakeTexture(64, 64);
    captured!(t1);
    const a = el.produceBitmap();

    const t2 = makeFakeTexture(64, 64);
    captured!(t2);
    const b = el.produceBitmap();
    expect(a).not.toBe(b);
  });
});

describe('ImageElement — round-trip', () => {
  test('toJSON → fromJSON identity', () => {
    const el = new ImageElement();
    el.fromJSON({ x: 1, y: 2, w: 3, h: 4, textureRef: 'base:tex/foo', fit: 'cover' });
    const fresh = new ImageElement();
    fresh.fromJSON(el.toJSON());
    expect(fresh.toJSON()).toEqual(el.toJSON());
  });
});
