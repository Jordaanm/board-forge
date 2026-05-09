// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { ImageRuntime } from './ElementRuntime';
import { type ImageElement, newElementId } from './SurfaceElement';
import { elementBitmapCache } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';

interface DrawCall { source: unknown; dx: number; dy: number; dw?: number; dh?: number; }

let drawCalls: DrawCall[] = [];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

function installRecordingCtx(): void {
  drawCalls = [];
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== '2d') return null;
    return {
      clearRect: () => {},
      drawImage: (...args: unknown[]) => {
        if (args.length === 3) {
          drawCalls.push({ source: args[0], dx: args[1] as number, dy: args[2] as number });
        } else if (args.length === 5) {
          drawCalls.push({
            source: args[0],
            dx: args[1] as number, dy: args[2] as number,
            dw: args[3] as number, dh: args[4] as number,
          });
        }
      },
    } as unknown as CanvasRenderingContext2D;
  } as any;
}

function makeImg(seed: Partial<ImageElement> = {}): ImageElement {
  return {
    id:         seed.id         ?? newElementId(),
    kind:       'image',
    x:          seed.x          ?? 0,
    y:          seed.y          ?? 0,
    w:          seed.w          ?? 100,
    h:          seed.h          ?? 100,
    textureRef: seed.textureRef ?? 'base:tex/x',
    fit:        seed.fit        ?? 'fit',
  };
}

function makeTexture(w: number, h: number, uuid: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  Object.defineProperty(tex, 'uuid', { value: uuid });
  return tex;
}

const ctx = { markDirty: () => {} };

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  installRecordingCtx();
  elementBitmapCache.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  elementBitmapCache.clear();
  vi.restoreAllMocks();
});

describe('ImageRuntime — asset subscription', () => {
  test('mount subscribes to AssetService for textureRef', () => {
    const subSpy = vi.spyOn(assetService, 'subscribe').mockReturnValue(() => {});
    const r = new ImageRuntime(ctx);
    r.mount(makeImg({ textureRef: 'base:tex/portrait' }));
    expect(subSpy).toHaveBeenCalledWith('base:tex/portrait', 'image', expect.any(Function));
  });

  test('unmount unsubscribes', () => {
    const unsub = vi.fn();
    vi.spyOn(assetService, 'subscribe').mockReturnValue(unsub);
    const r = new ImageRuntime(ctx);
    r.mount(makeImg());
    r.unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  test('update with same textureRef keeps the existing subscription', () => {
    const unsub = vi.fn();
    const subSpy = vi.spyOn(assetService, 'subscribe').mockReturnValue(unsub);
    const r = new ImageRuntime(ctx);
    const a = makeImg({ textureRef: 'a' });
    r.mount(a);
    r.update(a, { ...a, w: 50 });
    expect(subSpy).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();
  });

  test('update with new textureRef unsubscribes + resubscribes', () => {
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    const subSpy = vi.spyOn(assetService, 'subscribe')
      .mockReturnValueOnce(unsubA)
      .mockReturnValueOnce(unsubB);
    const r = new ImageRuntime(ctx);
    const a = makeImg({ textureRef: 'a' });
    r.mount(a);
    r.update(a, { ...a, textureRef: 'b' });
    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(subSpy).toHaveBeenCalledTimes(2);
  });

  test('listener flips dirty + subsequent produceBitmap draws the resolved texture', () => {
    let listener: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref, _type, cb) => {
      listener = cb as unknown as (tex: THREE.Texture) => void;
      return () => {};
    });
    const markDirty = vi.fn();
    const r = new ImageRuntime({ markDirty });
    r.mount(makeImg({ w: 100, h: 100, fit: 'stretch' }));
    expect(r.produceBitmap()).toBeNull();
    listener!(makeTexture(50, 50, 'tex-1'));
    expect(markDirty).toHaveBeenCalled();
    const bmp = r.produceBitmap();
    expect(bmp).not.toBeNull();
  });
});

describe('ImageRuntime — fit modes', () => {
  function setupResolvedTexture(w: number, h: number, uuid: string): ImageRuntime {
    let listener: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref, _type, cb) => {
      listener = cb as unknown as (tex: THREE.Texture) => void;
      return () => {};
    });
    const r = new ImageRuntime(ctx);
    return Object.assign(r, {
      _resolve: (state: ImageElement) => {
        r.mount(state);
        listener!(makeTexture(w, h, uuid));
      },
    }) as ImageRuntime & { _resolve: (s: ImageElement) => void };
  }

  test('stretch draws across full bounds', () => {
    const r = setupResolvedTexture(50, 50, 'tex-stretch') as any;
    r._resolve(makeImg({ w: 100, h: 100, fit: 'stretch' }));
    r.produceBitmap();
    const c = drawCalls[0];
    expect(c.dx).toBe(0);
    expect(c.dy).toBe(0);
    expect(c.dw).toBe(100);
    expect(c.dh).toBe(100);
  });

  test('fit centers and preserves aspect (letterbox)', () => {
    const r = setupResolvedTexture(50, 100, 'tex-fit') as any;
    r._resolve(makeImg({ w: 100, h: 100, fit: 'fit' }));
    r.produceBitmap();
    const c = drawCalls[0];
    expect(c.dw).toBe(50);
    expect(c.dh).toBe(100);
    expect(c.dx).toBe(25);
    expect(c.dy).toBe(0);
  });

  test('cover crops to fill bounds', () => {
    const r = setupResolvedTexture(50, 100, 'tex-cover') as any;
    r._resolve(makeImg({ w: 100, h: 100, fit: 'cover' }));
    r.produceBitmap();
    const c = drawCalls[0];
    expect(c.dw).toBe(100);
    expect(c.dh).toBe(200);
  });
});

describe('ImageRuntime — cache key', () => {
  test('same texture uuid + size + fit → same bitmap reference', () => {
    let listener: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref, _type, cb) => {
      listener = cb as unknown as (tex: THREE.Texture) => void;
      return () => {};
    });
    const r = new ImageRuntime(ctx);
    r.mount(makeImg({ w: 100, h: 100, fit: 'fit' }));
    listener!(makeTexture(50, 50, 'tex-cache'));
    const a = r.produceBitmap();
    const b = r.produceBitmap();
    expect(a).toBe(b);
  });
});
