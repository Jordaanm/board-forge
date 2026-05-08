// @vitest-environment jsdom
import { describe, test, expect, vi } from 'vitest';
import { SatoriRenderer, type SatoriFn, type ParseHtmlFn, type SatoriFont } from './SatoriRenderer';

// jsdom does not rasterise SVG via Image. Tests inject a fake satori +
// parser + rasteriser so we exercise the orchestration without depending on
// the real WASM pipeline; this matches "deep module, testable in isolation
// with a fake font loader" from the issue brief.

function makeRenderer(overrides: {
  satori?: SatoriFn;
  parser?: ParseHtmlFn;
  fonts?:  SatoriFont[];
  loadSatoriCounter?: { n: number };
  loadFontsCounter?:  { n: number };
} = {}): SatoriRenderer {
  const satori = overrides.satori ?? (async (_t, _o) => '<svg></svg>');
  const parser = overrides.parser ?? ((html: string) => ({ html }));
  const fonts  = overrides.fonts ?? [];
  const sCount = overrides.loadSatoriCounter ?? { n: 0 };
  const fCount = overrides.loadFontsCounter  ?? { n: 0 };
  const fakeCanvas = { width: 0, height: 0 } as HTMLCanvasElement;
  return new SatoriRenderer({
    loadSatori: async () => { sCount.n++; return satori; },
    loadParser: async () => parser,
    loadFonts:  async () => { fCount.n++; return fonts; },
    rasterize:  async (_svg, w, h) => {
      const c = { width: w, height: h } as HTMLCanvasElement;
      return c;
    },
  });
  void fakeCanvas;
}

describe('SatoriRenderer — render orchestration', () => {
  test('parses HTML, calls satori with width/height/fonts, rasterises SVG', async () => {
    const seenSatoriArgs: Array<{ tree: unknown; opts: unknown }> = [];
    const fonts: SatoriFont[] = [
      { name: 'Inter', data: new ArrayBuffer(1), weight: 400, style: 'normal' },
    ];
    const seenSvg: string[] = [];
    const r = new SatoriRenderer({
      loadSatori: async () => async (tree, opts) => {
        seenSatoriArgs.push({ tree, opts });
        return '<svg width="200" height="100"></svg>';
      },
      loadParser: async () => (html: string) => ({ kind: 'parsed', src: html }),
      loadFonts:  async () => fonts,
      rasterize:  async (svg, w, h) => {
        seenSvg.push(svg);
        return { width: w, height: h } as HTMLCanvasElement;
      },
    });

    const out = await r.render('<div>hi</div>', 200, 100);
    expect(out.width).toBe(200);
    expect(out.height).toBe(100);
    expect(seenSvg).toEqual(['<svg width="200" height="100"></svg>']);
    expect(seenSatoriArgs.length).toBe(1);
    expect(seenSatoriArgs[0].tree).toEqual({ kind: 'parsed', src: '<div>hi</div>' });
    expect(seenSatoriArgs[0].opts).toEqual({ width: 200, height: 100, fonts });
  });

  test('errors during load bubble up through the returned promise', async () => {
    const r = new SatoriRenderer({
      loadSatori: async () => { throw new Error('boom'); },
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async () => ({ width: 1, height: 1 } as HTMLCanvasElement),
    });
    await expect(r.render('<div/>', 10, 10)).rejects.toThrow('boom');
  });

  test('errors during render bubble up through the returned promise', async () => {
    const r = new SatoriRenderer({
      loadSatori: async () => async () => { throw new Error('render-fail'); },
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async () => ({ width: 1, height: 1 } as HTMLCanvasElement),
    });
    await expect(r.render('<div/>', 10, 10)).rejects.toThrow('render-fail');
  });
});

describe('SatoriRenderer — init memoisation (no double-load)', () => {
  test('concurrent first calls share one initialisation', async () => {
    const sCount = { n: 0 };
    const fCount = { n: 0 };
    const r = makeRenderer({ loadSatoriCounter: sCount, loadFontsCounter: fCount });

    await Promise.all([
      r.render('<div/>', 10, 10),
      r.render('<div/>', 10, 10),
      r.render('<div/>', 10, 10),
    ]);
    expect(sCount.n).toBe(1);
    expect(fCount.n).toBe(1);
  });

  test('sequential calls reuse the loaded module', async () => {
    const sCount = { n: 0 };
    const fCount = { n: 0 };
    const r = makeRenderer({ loadSatoriCounter: sCount, loadFontsCounter: fCount });

    await r.render('<div/>', 10, 10);
    await r.render('<div/>', 20, 20);
    await r.render('<div/>', 30, 30);
    expect(sCount.n).toBe(1);
    expect(fCount.n).toBe(1);
  });

  test('failed init clears the cache so a follow-up call retries', async () => {
    let attempt = 0;
    const r = new SatoriRenderer({
      loadSatori: async () => {
        attempt++;
        if (attempt === 1) throw new Error('first-fail');
        return async () => '<svg/>';
      },
      loadParser: async () => (h: string) => h,
      loadFonts:  async () => [],
      rasterize:  async (_, w, h) => ({ width: w, height: h } as HTMLCanvasElement),
    });

    await expect(r.render('<div/>', 10, 10)).rejects.toThrow('first-fail');
    const ok = await r.render('<div/>', 10, 10);
    expect(ok.width).toBe(10);
    expect(attempt).toBe(2);
  });
});

describe('SatoriRenderer — default rasterize (DOM gated)', () => {
  test('produces a canvas of expected dimensions from a known SVG via the default rasteriser', async () => {
    // Skip when DOM rasterisation primitives aren't available. jsdom does
    // not implement URL.createObjectURL or fire SVG `onload`, so we stub
    // them locally and exercise the *default* rasterize path end to end.
    if (typeof Image === 'undefined') return;

    const realCreate = (URL as unknown as { createObjectURL?: (b: Blob) => string }).createObjectURL;
    const realRevoke = (URL as unknown as { revokeObjectURL?: (u: string) => void }).revokeObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:fake';
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};

    const realImage = (globalThis as unknown as { Image: typeof Image }).Image;
    class StubImage {
      onload:  (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      width  = 64;
      height = 32;
      naturalWidth  = 64;
      naturalHeight = 32;
      set src(_v: string) { queueMicrotask(() => { if (this.onload) this.onload(); }); }
      get src() { return ''; }
    }
    (globalThis as unknown as { Image: unknown }).Image = StubImage;

    const realGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === '2d') return { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
      return null;
    } as unknown as typeof realGetContext;

    try {
      const r = new SatoriRenderer({
        loadSatori: async () => async () => '<svg width="64" height="32"></svg>',
        loadParser: async () => (h: string) => h,
        loadFonts:  async () => [],
        // No rasterize override — exercise the default code path.
      });
      const out = await r.render('<div/>', 64, 32);
      expect(out.width).toBe(64);
      expect(out.height).toBe(32);
    } finally {
      (globalThis as unknown as { Image: typeof Image }).Image = realImage;
      HTMLCanvasElement.prototype.getContext = realGetContext;
      if (realCreate) (URL as unknown as { createObjectURL: typeof realCreate }).createObjectURL = realCreate;
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      if (realRevoke) (URL as unknown as { revokeObjectURL: typeof realRevoke }).revokeObjectURL = realRevoke;
      else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });
});
