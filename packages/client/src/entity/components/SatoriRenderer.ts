// Lazy-loaded HTML→bitmap pipeline (issue #7 of issues--ui-surface.md).
//
// Deep module wrapping `satori` + `satori-html` + bundled-font registration.
// First `render` call dynamically imports the heavy deps and loads the
// bundled-font ArrayBuffers; subsequent calls reuse the loaded module. The
// initialisation promise is memoised so concurrent first-callers share one
// load (no double-init, no double-fetch).
//
// All external dependencies are injectable via the constructor so unit tests
// can drive the pipeline without a real Satori install. Production callers
// use the exported `satoriRenderer` singleton with default loaders.

export type SatoriBitmap = HTMLCanvasElement | OffscreenCanvas;

export interface SatoriFont {
  name:    string;
  data:    ArrayBuffer;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?:  'normal' | 'italic';
}

// Mirror of satori's public surface, narrow enough to inject.
export type SatoriFn = (
  element: unknown,
  options: { width: number; height: number; fonts: SatoriFont[] },
) => Promise<string>;

export type ParseHtmlFn = (html: string) => unknown;

export type RasterizeSvgFn = (svg: string, w: number, h: number) => Promise<SatoriBitmap>;

export interface SatoriRendererOptions {
  loadSatori?:  () => Promise<SatoriFn>;
  loadParser?:  () => Promise<ParseHtmlFn>;
  loadFonts?:   () => Promise<SatoriFont[]>;
  rasterize?:   RasterizeSvgFn;
}

export class SatoriRenderer {
  private readonly opts: Required<SatoriRendererOptions>;
  private initPromise: Promise<{ satori: SatoriFn; parse: ParseHtmlFn; fonts: SatoriFont[] }> | null = null;

  constructor(opts: SatoriRendererOptions = {}) {
    this.opts = {
      loadSatori: opts.loadSatori ?? defaultLoadSatori,
      loadParser: opts.loadParser ?? defaultLoadParser,
      loadFonts:  opts.loadFonts  ?? defaultLoadFonts,
      rasterize:  opts.rasterize  ?? defaultRasterize,
    };
  }

  // Returns a canvas of `(w, h)` containing the rasterised HTML.
  // Errors during load or render bubble up — callers fall back to an empty
  // bitmap on rejection.
  async render(html: string, w: number, h: number): Promise<SatoriBitmap> {
    const { satori, parse, fonts } = await this.init();
    const tree = parse(html);
    const svg  = await satori(tree, { width: w, height: h, fonts });
    return this.opts.rasterize(svg, w, h);
  }

  // Memoised init — concurrent callers share one in-flight promise.
  private init(): Promise<{ satori: SatoriFn; parse: ParseHtmlFn; fonts: SatoriFont[] }> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const [satori, parse, fonts] = await Promise.all([
        this.opts.loadSatori(),
        this.opts.loadParser(),
        this.opts.loadFonts(),
      ]);
      return { satori, parse, fonts };
    })();
    // If init fails, drop the cached promise so a future call retries.
    this.initPromise.catch(() => { this.initPromise = null; });
    return this.initPromise;
  }
}

async function defaultLoadSatori(): Promise<SatoriFn> {
  const mod = await import('satori');
  return mod.default as SatoriFn;
}

async function defaultLoadParser(): Promise<ParseHtmlFn> {
  const mod = await import('satori-html');
  return mod.html as ParseHtmlFn;
}

// Bundled-font loader. v1 ships Inter regular + bold from the static `/fonts/`
// path on the client. Failures (missing files, offline tests) resolve to an
// empty list so non-text content (shapes, images) still rasterises.
async function defaultLoadFonts(): Promise<SatoriFont[]> {
  if (typeof fetch === 'undefined') return [];
  const tryFetch = async (url: string, weight: 400 | 700): Promise<SatoriFont | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      return { name: 'Inter', data, weight, style: 'normal' };
    } catch { return null; }
  };
  const [reg, bold] = await Promise.all([
    tryFetch('/fonts/inter-regular.ttf', 400),
    tryFetch('/fonts/inter-bold.ttf',    700),
  ]);
  return [reg, bold].filter((f): f is SatoriFont => f !== null);
}

// Default SVG rasteriser. Builds an Image from a blob URL and draws onto a
// canvas at `(w, h)`. The image is disposed via revokeObjectURL after draw.
async function defaultRasterize(svg: string, w: number, h: number): Promise<SatoriBitmap> {
  if (typeof document === 'undefined') {
    throw new Error('SatoriRenderer.rasterize: no DOM available');
  }
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas  = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('SatoriRenderer.rasterize: 2d context unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

// Production singleton. Tests construct their own instances with injected
// loaders, so this stays a process-global default for runtime use.
export const satoriRenderer = new SatoriRenderer();
