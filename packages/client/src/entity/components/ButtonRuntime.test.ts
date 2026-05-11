// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { ButtonRuntime, type RuntimeContext } from './ElementRuntime';
import { type ButtonElement, newElementId } from './SurfaceElement';
import { elementBitmapCache } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';
import type { Listener } from '../EntityEventBus';

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

function makeBtn(seed: Partial<ButtonElement> = {}): ButtonElement {
  return {
    id:         seed.id         ?? newElementId(),
    kind:       'button',
    x:          seed.x          ?? 0,
    y:          seed.y          ?? 0,
    w:          seed.w          ?? 100,
    h:          seed.h          ?? 100,
    normalRef:  seed.normalRef  ?? 'base:tex/normal',
    hoveredRef: seed.hoveredRef,
    pressedRef: seed.pressedRef,
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

// Mocks AssetService.subscribe so each ref gets its own listener slot. The
// returned `resolve(ref, tex)` invokes the corresponding listener.
function captureSubs(): {
  resolve:  (ref: string, tex: THREE.Texture) => void;
  unsubMap: Map<string, ReturnType<typeof vi.fn>>;
  subSpy:   ReturnType<typeof vi.spyOn>;
} {
  const listeners = new Map<string, (tex: THREE.Texture) => void>();
  const unsubMap  = new Map<string, ReturnType<typeof vi.fn>>();
  const subSpy = vi.spyOn(assetService, 'subscribe').mockImplementation(
    (ref: string, _type: 'image' | 'model' | 'sound', cb: any) => {
      listeners.set(ref, cb);
      const u = vi.fn();
      unsubMap.set(ref, u);
      return u;
    },
  ) as unknown as ReturnType<typeof vi.spyOn>;
  return {
    resolve: (ref, tex) => listeners.get(ref)?.(tex),
    unsubMap,
    subSpy,
  };
}

// Pluggable bus: `dispatch(event, payload)` fires registered listeners.
function makeBus(): { ctx: RuntimeContext; dispatch: (event: string, payload?: unknown) => void; markDirty: ReturnType<typeof vi.fn> } {
  const listeners = new Map<string, Listener[]>();
  const markDirty = vi.fn();
  const ctx: RuntimeContext = {
    markDirty,
    addInputListener(event, cb) {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
      return () => {
        const next = (listeners.get(event) ?? []).filter((c) => c !== cb);
        listeners.set(event, next);
      };
    },
  };
  return {
    ctx,
    dispatch: (event, payload) => {
      const arr = listeners.get(event) ?? [];
      for (const cb of arr) cb(payload);
    },
    markDirty,
  };
}

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

describe('ButtonRuntime — asset subscriptions', () => {
  test('mount subscribes to all three image refs', () => {
    const { subSpy } = captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'a', hoveredRef: 'b', pressedRef: 'c' }));
    const refs = (subSpy as any).mock.calls.map((c: unknown[]) => c[0]).sort();
    expect(refs).toEqual(['a', 'b', 'c']);
  });

  test('mount skips empty refs (no subscribe call)', () => {
    const { subSpy } = captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'a' }));  // hovered/pressed default to undefined
    expect((subSpy as any).mock.calls).toHaveLength(1);
    expect((subSpy as any).mock.calls[0][0]).toBe('a');
  });

  test('unmount unsubscribes every active slot', () => {
    const { unsubMap } = captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'a', hoveredRef: 'b', pressedRef: 'c' }));
    r.unmount();
    expect(unsubMap.get('a')).toHaveBeenCalledTimes(1);
    expect(unsubMap.get('b')).toHaveBeenCalledTimes(1);
    expect(unsubMap.get('c')).toHaveBeenCalledTimes(1);
  });

  test('update with new hovered ref unsubs old + subs new', () => {
    const { unsubMap, subSpy } = captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    const a = makeBtn({ normalRef: 'n', hoveredRef: 'h1' });
    r.mount(a);
    (subSpy as any).mockClear();
    r.update(a, { ...a, hoveredRef: 'h2' });
    expect(unsubMap.get('h1')).toHaveBeenCalledTimes(1);
    expect((subSpy as any).mock.calls[0][0]).toBe('h2');
  });
});

describe('ButtonRuntime — input state → texture choice', () => {
  test('idle renders normal', () => {
    const { resolve } = captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', pressedRef: 'p', fit: 'stretch' }));
    const nTex = makeTexture(50, 50, 'tex-normal');
    const hTex = makeTexture(50, 50, 'tex-hovered');
    const pTex = makeTexture(50, 50, 'tex-pressed');
    resolve('n', nTex); resolve('h', hTex); resolve('p', pTex);
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(nTex.image);
  });

  test('hover-start switches to hovered texture + flips dirty', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch, markDirty } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', pressedRef: 'p', fit: 'stretch' }));
    resolve('n', makeTexture(50, 50, 'tex-n'));
    const hTex = makeTexture(50, 50, 'tex-h');
    resolve('h', hTex);
    markDirty.mockClear();
    dispatch('hover-start');
    expect(markDirty).toHaveBeenCalled();
    drawCalls.length = 0;
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(hTex.image);
  });

  test('pressed switches to pressed texture', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', pressedRef: 'p', fit: 'stretch' }));
    const nTex = makeTexture(50, 50, 'tex-n');
    const hTex = makeTexture(50, 50, 'tex-h');
    const pTex = makeTexture(50, 50, 'tex-p');
    resolve('n', nTex); resolve('h', hTex); resolve('p', pTex);
    dispatch('hover-start');
    dispatch('pressed');
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(pTex.image);
  });

  test('released returns to hover state', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', pressedRef: 'p', fit: 'stretch' }));
    const hTex = makeTexture(50, 50, 'tex-h');
    resolve('n', makeTexture(50, 50, 'tex-n'));
    resolve('h', hTex);
    resolve('p', makeTexture(50, 50, 'tex-p'));
    dispatch('hover-start');
    dispatch('pressed');
    dispatch('released');
    drawCalls.length = 0;
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(hTex.image);
  });

  test('hover-end resets to idle (renders normal again)', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', pressedRef: 'p', fit: 'stretch' }));
    const nTex = makeTexture(50, 50, 'tex-n');
    resolve('n', nTex);
    resolve('h', makeTexture(50, 50, 'tex-h'));
    dispatch('hover-start');
    dispatch('hover-end');
    drawCalls.length = 0;
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(nTex.image);
  });

  test('hover-end while pressed clears press state', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', pressedRef: 'p', fit: 'stretch' }));
    const nTex = makeTexture(50, 50, 'tex-n');
    resolve('n', nTex);
    resolve('h', makeTexture(50, 50, 'tex-h'));
    resolve('p', makeTexture(50, 50, 'tex-p'));
    dispatch('hover-start');
    dispatch('pressed');
    dispatch('hover-end');
    drawCalls.length = 0;
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(nTex.image);
  });
});

describe('ButtonRuntime — fallback to normal', () => {
  test('hovered missing → falls back to normal texture', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', fit: 'stretch' }));  // no hovered
    const nTex = makeTexture(50, 50, 'tex-n');
    resolve('n', nTex);
    dispatch('hover-start');
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(nTex.image);
  });

  test('pressed missing → falls back to normal texture', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', fit: 'stretch' }));
    const nTex = makeTexture(50, 50, 'tex-n');
    resolve('n', nTex);
    resolve('h', makeTexture(50, 50, 'tex-h'));
    dispatch('hover-start');
    dispatch('pressed');
    r.produceBitmap();
    expect(drawCalls[0].source).toBe(nTex.image);
  });

  test('normal not yet loaded → produceBitmap returns null', () => {
    captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n' }));
    expect(r.produceBitmap()).toBeNull();
  });

  test('zero-size returns null', () => {
    captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', w: 0, h: 0 }));
    expect(r.produceBitmap()).toBeNull();
  });
});

describe('ButtonRuntime — cache + dirty signaling', () => {
  test('image listener flips dirty when texture resolves', () => {
    const { resolve } = captureSubs();
    const { ctx, markDirty } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n' }));
    markDirty.mockClear();
    resolve('n', makeTexture(50, 50, 'tex-n'));
    expect(markDirty).toHaveBeenCalled();
  });

  test('same texture + size + fit reuses cached bitmap', () => {
    const { resolve } = captureSubs();
    const { ctx } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', fit: 'fit' }));
    resolve('n', makeTexture(50, 50, 'tex-cache'));
    const a = r.produceBitmap();
    const b = r.produceBitmap();
    expect(a).toBe(b);
  });

  test('idle vs hover with different textures produce different bitmaps', () => {
    const { resolve } = captureSubs();
    const { ctx, dispatch } = makeBus();
    const r = new ButtonRuntime(ctx);
    r.mount(makeBtn({ normalRef: 'n', hoveredRef: 'h', fit: 'fit' }));
    resolve('n', makeTexture(50, 50, 'tex-n'));
    resolve('h', makeTexture(50, 50, 'tex-h'));
    const idle = r.produceBitmap();
    dispatch('hover-start');
    const hover = r.produceBitmap();
    expect(idle).not.toBe(hover);
  });
});
