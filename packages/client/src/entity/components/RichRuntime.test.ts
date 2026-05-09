// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { RichRuntime, extractImageRefs, substituteImageUrls } from './ElementRuntime';
import { type RichElement, newElementId } from './SurfaceElement';
import { elementBitmapCache } from './ElementBitmapCache';
import { assetService } from '../../assets/AssetService';

function makeRich(seed: Partial<RichElement> = {}): RichElement {
  return {
    id:    seed.id   ?? newElementId(),
    kind:  'rich',
    x:     seed.x    ?? 0,
    y:     seed.y    ?? 0,
    w:     seed.w    ?? 100,
    h:     seed.h    ?? 100,
    html:  seed.html ?? '<div>hi</div>',
  };
}

function makeRenderer(impl?: (html: string, w: number, h: number) => Promise<HTMLCanvasElement>) {
  return {
    render: vi.fn(impl ?? (async (_html, w, h) => {
      const c = document.createElement('canvas');
      c.width  = w;
      c.height = h;
      return c;
    })),
  };
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalToDataUrl:  typeof HTMLCanvasElement.prototype.toDataURL;

beforeEach(() => {
  elementBitmapCache.clear();
  // jsdom returns null from getContext('2d'); install a stub so
  // `textureToDataUrl` can succeed (RichRuntime needs it to flip subs ready).
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  originalToDataUrl  = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== '2d') return null;
    return { drawImage: () => {}, clearRect: () => {} } as unknown as CanvasRenderingContext2D;
  } as any;
  HTMLCanvasElement.prototype.toDataURL = function () {
    return 'data:image/png;base64,stub';
  } as any;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toDataURL  = originalToDataUrl;
  elementBitmapCache.clear();
  vi.restoreAllMocks();
});

describe('extractImageRefs', () => {
  test('extracts every src attribute (single + double quotes)', () => {
    const html = `<img src="a.png"><div></div><img src='b.png'>`;
    expect(extractImageRefs(html)).toEqual(['a.png', 'b.png']);
  });

  test('returns empty for html with no img tags', () => {
    expect(extractImageRefs('<div>hi</div>')).toEqual([]);
  });
});

describe('substituteImageUrls', () => {
  test('replaces each ref with its mapped url', () => {
    const out = substituteImageUrls('<img src="a"><img src="b">', new Map([['a', 'A'], ['b', 'B']]));
    expect(out).toContain('"A"');
    expect(out).toContain('"B"');
  });

  test('leaves unmapped refs untouched', () => {
    const out = substituteImageUrls('<img src="a">', new Map([['b', 'B']]));
    expect(out).toContain('"a"');
  });
});

describe('RichRuntime — subscriptions', () => {
  test('mount with no img refs subscribes to nothing; produceBitmap kicks off render', () => {
    const subSpy = vi.spyOn(assetService, 'subscribe').mockReturnValue(() => {});
    const renderer = makeRenderer();
    const r = new RichRuntime({ markDirty: () => {} });
    r.renderer = renderer as any;
    r.mount(makeRich({ html: '<div>plain</div>' }));
    expect(subSpy).not.toHaveBeenCalled();

    expect(r.produceBitmap()).toBeNull();
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  test('mount with img refs subscribes once per unique ref', () => {
    const subSpy = vi.spyOn(assetService, 'subscribe').mockReturnValue(() => {});
    const r = new RichRuntime({ markDirty: () => {} });
    r.renderer = makeRenderer() as any;
    r.mount(makeRich({ html: `<img src="a"><img src="b"><img src="a">` }));
    expect(subSpy).toHaveBeenCalledTimes(2);
  });

  test('update with new html re-syncs subs (drops gone refs, adds new ones)', () => {
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    let count = 0;
    vi.spyOn(assetService, 'subscribe').mockImplementation(() => count++ === 0 ? unsubA : unsubB);
    const r = new RichRuntime({ markDirty: () => {} });
    r.renderer = makeRenderer() as any;
    const a = makeRich({ html: `<img src="a">` });
    r.mount(a);
    expect(count).toBe(1);
    r.update(a, { ...a, html: `<img src="b">` });
    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(count).toBe(2);
  });

  test('unmount unsubscribes everything', () => {
    const unsub = vi.fn();
    vi.spyOn(assetService, 'subscribe').mockReturnValue(unsub);
    const r = new RichRuntime({ markDirty: () => {} });
    r.renderer = makeRenderer() as any;
    r.mount(makeRich({ html: `<img src="a"><img src="b">` }));
    r.unmount();
    expect(unsub).toHaveBeenCalledTimes(2);
  });
});

describe('RichRuntime — render flow', () => {
  test('produceBitmap returns null while any sub is pending', () => {
    vi.spyOn(assetService, 'subscribe').mockReturnValue(() => {});
    const r = new RichRuntime({ markDirty: () => {} });
    r.renderer = makeRenderer() as any;
    r.mount(makeRich({ html: `<img src="a">` }));
    expect(r.produceBitmap()).toBeNull();
  });

  test('once all images resolve, produceBitmap kicks off a render and returns the cached bitmap', async () => {
    let listener: ((tex: THREE.Texture) => void) | null = null;
    vi.spyOn(assetService, 'subscribe').mockImplementation((_ref, _type, cb) => {
      listener = cb as unknown as (tex: THREE.Texture) => void;
      return () => {};
    });
    const renderer = makeRenderer();
    const markDirty = vi.fn();
    const r = new RichRuntime({ markDirty });
    r.renderer = renderer as any;
    r.mount(makeRich({ html: `<img src="a">` }));

    // Resolve the asset → mark sub ready.
    const tex = makeImageTexture();
    listener!(tex);

    // First produceBitmap kicks off a render and returns null while in-flight.
    expect(r.produceBitmap()).toBeNull();
    await renderer.render.mock.results[0].value;
    expect(markDirty).toHaveBeenCalled();
    expect(r.produceBitmap()).not.toBeNull();
  });

  test('render failure logs + clears in-flight without throwing', async () => {
    vi.spyOn(assetService, 'subscribe').mockReturnValue(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const renderer = makeRenderer(async () => { throw new Error('boom'); });
    const r = new RichRuntime({ markDirty: () => {} });
    r.renderer = renderer as any;
    r.mount(makeRich({ html: '<div/>' }));
    r.produceBitmap();  // kicks off render
    await renderer.render.mock.results[0].value.catch(() => {});
    expect(errSpy).toHaveBeenCalled();
  });
});

function makeImageTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
