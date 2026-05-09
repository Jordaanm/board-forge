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
import { RichElement, extractImageRefs, substituteImageUrls } from './RichElement';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { elementBitmapCache } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';
import { SatoriRenderer } from './SatoriRenderer';

function installRecordingCtx(): { calls: unknown[] } {
  const calls: unknown[] = [];
  const ctx: any = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect: () => {}, fillRect: () => {}, strokeRect: () => {}, rect: () => {},
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arcTo: () => {}, arc: () => {}, ellipse: () => {},
    fill: () => {}, stroke: () => {},
    drawImage: (...args: unknown[]) => { calls.push(args); },
  };
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type === '2d') return ctx;
    return null;
  } as any;
  HTMLCanvasElement.prototype.toDataURL = function () {
    return 'data:image/png;base64,STUB';
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
let originalToDataURL:  typeof HTMLCanvasElement.prototype.toDataURL;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  originalToDataURL  = HTMLCanvasElement.prototype.toDataURL;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toDataURL  = originalToDataURL;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
  vi.restoreAllMocks();
});

interface SpawnOpts {
  state?:    Partial<RichElement['state']>;
  renderer?: SatoriRenderer;
}

function spawnRich(opts: SpawnOpts = {}): {
  scene:    SceneImpl;
  ctx:      SpawnContext;
  parent:   Entity;
  surface:  SurfaceComponent;
  child:    Entity;
  el:       RichElement;
} {
  installRecordingCtx();
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

  const child = new Entity({ id: 'c-1', type: 'rich-element', name: 'Rich', parentId: parent.id });
  parent.children.push(child.id);
  const el = new RichElement();
  if (opts.renderer) el.renderer = opts.renderer;
  el.fromJSON({
    x: 0, y: 0, w: 200, h: 100,
    html: '<div>hi</div>',
    ...opts.state,
  });
  child.attachComponent(el);
  scene.add(child);
  el.onSpawn(ctx);

  return { scene, ctx, parent, surface, child, el };
}

describe('RichElement — registration', () => {
  test('static metadata', () => {
    expect(RichElement.typeId).toBe('rich-element');
    expect(RichElement.requires).toEqual([]);
  });
});

describe('extractImageRefs', () => {
  test('returns empty when no <img>', () => {
    expect(extractImageRefs('<div>hi</div>')).toEqual([]);
  });
  test('extracts double-quoted src', () => {
    expect(extractImageRefs('<img src="base:tex/foo">')).toEqual(['base:tex/foo']);
  });
  test('extracts single-quoted src', () => {
    expect(extractImageRefs("<img src='base:tex/bar'>")).toEqual(['base:tex/bar']);
  });
  test('extracts multiple, in order', () => {
    expect(extractImageRefs('<img src="a"/><span/><img src="b">')).toEqual(['a', 'b']);
  });
  test('tolerates other attributes', () => {
    expect(extractImageRefs('<img class="x" src="foo" alt="y">')).toEqual(['foo']);
  });
});

describe('substituteImageUrls', () => {
  test('rewrites refs that exist in the map', () => {
    const out = substituteImageUrls('<img src="base:tex/foo">', new Map([['base:tex/foo', 'data:image/png;base64,X']]));
    expect(out).toBe('<img src="data:image/png;base64,X">');
  });
  test('leaves untouched refs that are not in the map', () => {
    const out = substituteImageUrls('<img src="missing">', new Map());
    expect(out).toBe('<img src="missing">');
  });
  test('preserves quote style', () => {
    const out = substituteImageUrls("<img src='a'>", new Map([['a', 'B']]));
    expect(out).toBe("<img src='B'>");
  });
});

describe('RichElement — AssetService bridge', () => {
  test('subscribes once per unique image ref on spawn', () => {
    const subSpy = vi.spyOn(assetService, 'subscribe');
    spawnRich({ state: { html: '<img src="base:tex/a"><img src="base:tex/b">' } });
    expect(subSpy).toHaveBeenCalledWith('base:tex/a', 'image', expect.any(Function));
    expect(subSpy).toHaveBeenCalledWith('base:tex/b', 'image', expect.any(Function));
  });

  test('unsubscribes on onDespawn', () => {
    const unsub = vi.fn();
    vi.spyOn(assetService, 'subscribe').mockReturnValue(unsub);
    const { el, ctx } = spawnRich({ state: { html: '<img src="base:tex/a">' } });
    el.onDespawn(ctx);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  test('html change re-syncs subscriptions: drops removed refs, adds new', () => {
    const calls: Array<{ ref: string; unsub: () => void }> = [];
    vi.spyOn(assetService, 'subscribe').mockImplementation((ref: string) => {
      const u = vi.fn();
      calls.push({ ref, unsub: u });
      return u;
    });
    const { el } = spawnRich({ state: { html: '<img src="a">' } });
    expect(calls.length).toBe(1);
    expect(calls[0].ref).toBe('a');

    el.setState({ html: '<img src="b">' });
    expect(calls[0].unsub).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(2);
    expect(calls[1].ref).toBe('b');
  });

  test('image resolve fires markParentSurfaceDirty', () => {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });
    spawnRich({ state: { html: '<img src="a">' } });
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);

    captured!(makeFakeTexture(64, 64));
    expect(surfaceRenderQueue.size()).toBe(1);
  });
});

describe('RichElement — render pipeline', () => {
  test('produceBitmap returns null while any image is pending; then renders once all resolve', async () => {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });

    const seenRenderArgs: Array<{ html: string; w: number; h: number }> = [];
    const fakeBitmap = { width: 200, height: 100 } as HTMLCanvasElement;
    const renderer = new SatoriRenderer({
      loadSatori: async () => async () => '<svg/>',
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async () => fakeBitmap,
    });
    vi.spyOn(renderer, 'render').mockImplementation(async (html: string, w: number, h: number) => {
      seenRenderArgs.push({ html, w, h });
      return fakeBitmap;
    });

    const { el } = spawnRich({
      state: { html: '<div><img src="a"></div>' },
      renderer,
    });

    // Initial pending: no resolved url, produceBitmap is null and no render fires.
    expect(el.produceBitmap()).toBeNull();
    expect(seenRenderArgs.length).toBe(0);

    // Resolve placeholder first — non-drawable yields null url, still pending.
    captured!(new THREE.DataTexture(new Uint8Array([0,0,0,0]), 1, 1, THREE.RGBAFormat));
    expect(el.produceBitmap()).toBeNull();
    expect(seenRenderArgs.length).toBe(0);

    // Resolve real image — element kicks off the async render.
    captured!(makeFakeTexture(8, 8));
    el.produceBitmap();
    await Promise.resolve(); await Promise.resolve();
    expect(seenRenderArgs.length).toBe(1);
    expect(seenRenderArgs[0].w).toBe(200);
    expect(seenRenderArgs[0].h).toBe(100);
    expect(seenRenderArgs[0].html).toBe('<div><img src="data:image/png;base64,STUB"></div>');

    // Cached on second produceBitmap.
    expect(el.produceBitmap()).toBe(fakeBitmap);
  });

  test('text-only HTML renders immediately (no subscriptions)', async () => {
    const subSpy = vi.spyOn(assetService, 'subscribe');
    const fakeBitmap = { width: 200, height: 100 } as HTMLCanvasElement;
    const renderer = new SatoriRenderer({
      loadSatori: async () => async () => '<svg/>',
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async () => fakeBitmap,
    });
    const renderSpy = vi.spyOn(renderer, 'render').mockResolvedValue(fakeBitmap);

    const { el } = spawnRich({
      state: { html: '<div>hello world</div>' },
      renderer,
    });
    expect(subSpy).not.toHaveBeenCalled();

    el.produceBitmap();
    await Promise.resolve(); await Promise.resolve();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0][0]).toBe('<div>hello world</div>');

    expect(el.produceBitmap()).toBe(fakeBitmap);
  });

  test('cache key depends on html + resolved image url, so identity flips on a refresh', async () => {
    let captured: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref: string, _type, listener) => {
      captured = listener as any;
      return () => {};
    });

    const renderer = new SatoriRenderer({
      loadSatori: async () => async () => '<svg/>',
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async () => ({ width: 1, height: 1 } as HTMLCanvasElement),
    });
    const renderResults: HTMLCanvasElement[] = [];
    vi.spyOn(renderer, 'render').mockImplementation(async () => {
      const bmp = { width: 1, height: 1 } as HTMLCanvasElement;
      renderResults.push(bmp);
      return bmp;
    });

    const { el } = spawnRich({
      state: { html: '<img src="a">' },
      renderer,
    });

    captured!(makeFakeTexture(8, 8));
    el.produceBitmap();
    await Promise.resolve(); await Promise.resolve();
    const first = el.produceBitmap();

    // Override toDataURL so the second resolve has a different "url". We
    // don't actually need a second resolve callback — change html instead,
    // which yields a different cache key path.
    el.setState({ html: '<img src="a"><span>x</span>' });
    el.produceBitmap();
    await Promise.resolve(); await Promise.resolve();
    const second = el.produceBitmap();
    expect(first).not.toBe(second);
  });

  test('render error does not crash; element returns null and a follow-up state change retries', async () => {
    const renderer = new SatoriRenderer({
      loadSatori: async () => async () => '<svg/>',
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async () => ({ width: 1, height: 1 } as HTMLCanvasElement),
    });
    let attempt = 0;
    const fakeBitmap = { width: 200, height: 100 } as HTMLCanvasElement;
    vi.spyOn(renderer, 'render').mockImplementation(async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return fakeBitmap;
    });

    const { el } = spawnRich({
      state: { html: '<div>x</div>' },
      renderer,
    });
    el.produceBitmap();
    await Promise.resolve(); await Promise.resolve();
    expect(el.produceBitmap()).toBeNull();

    el.setState({ html: '<div>y</div>' });
    el.produceBitmap();
    await Promise.resolve(); await Promise.resolve();
    expect(el.produceBitmap()).toBe(fakeBitmap);
  });
});

describe('RichElement — round-trip', () => {
  test('toJSON → fromJSON identity', () => {
    const el = new RichElement();
    el.fromJSON({ x: 1, y: 2, w: 3, h: 4, html: '<b>hi</b>' });
    const fresh = new RichElement();
    fresh.fromJSON(el.toJSON());
    expect(fresh.toJSON()).toEqual(el.toJSON());
  });
});
