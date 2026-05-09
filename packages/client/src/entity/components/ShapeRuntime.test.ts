// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { ShapeRuntime } from './ElementRuntime';
import { type ShapeElement, newElementId } from './SurfaceElement';
import { elementBitmapCache } from './ElementBitmapCache';

interface RecordingCtx {
  ops:    string[];
  fills:  string[];
  strokes: string[];
  ctx:    CanvasRenderingContext2D;
}

let recording: RecordingCtx | null = null;
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

function installRecordingCtx(): RecordingCtx {
  const ops: string[] = [];
  const fills: string[]   = [];
  const strokes: string[] = [];
  const proxy: any = {
    _fillStyle:   '',
    _strokeStyle: '',
    lineWidth:    1,
    set fillStyle(v: string)   { this._fillStyle = v; },
    get fillStyle()            { return this._fillStyle; },
    set strokeStyle(v: string) { this._strokeStyle = v; },
    get strokeStyle()          { return this._strokeStyle; },
    clearRect: () => { ops.push('clearRect'); },
    rect:      () => { ops.push('rect'); },
    beginPath: () => { ops.push('beginPath'); },
    closePath: () => { ops.push('closePath'); },
    moveTo:    () => { ops.push('moveTo'); },
    lineTo:    () => { ops.push('lineTo'); },
    arcTo:     () => { ops.push('arcTo'); },
    arc:       () => { ops.push('arc'); },
    ellipse:   () => { ops.push('ellipse'); },
    fill:      function () { ops.push('fill');   fills  .push(this._fillStyle); },
    stroke:    function () { ops.push('stroke'); strokes.push(this._strokeStyle); },
    drawImage: () => { ops.push('drawImage'); },
  };
  const rec: RecordingCtx = { ops, fills, strokes, ctx: proxy as CanvasRenderingContext2D };
  recording = rec;
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === '2d') return proxy;
    return null;
  } as any;
  return rec;
}

function makeShape(seed: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id:    seed.id    ?? newElementId(),
    kind:  'shape',
    shape: seed.shape ?? 'rect',
    x:     seed.x     ?? 0,
    y:     seed.y     ?? 0,
    w:     seed.w     ?? 50,
    h:     seed.h     ?? 50,
    fill:        seed.fill,
    stroke:      seed.stroke,
    strokeWidth: seed.strokeWidth,
    radius:      seed.radius,
  };
}

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  installRecordingCtx();
  elementBitmapCache.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  recording = null;
  elementBitmapCache.clear();
});

describe('ShapeRuntime — drawing', () => {
  test('rect with fill calls clearRect + rect + fill', () => {
    const r = new ShapeRuntime();
    r.mount(makeShape({ shape: 'rect', fill: '#f00', radius: 0 }));
    r.produceBitmap();
    expect(recording!.ops).toContain('clearRect');
    expect(recording!.ops).toContain('rect');
    expect(recording!.ops).toContain('fill');
    expect(recording!.fills[0]).toBe('#f00');
  });

  test('circle with fill + stroke calls ellipse + fill + stroke', () => {
    const r = new ShapeRuntime();
    r.mount(makeShape({ shape: 'circle', fill: '#0f0', stroke: '#000', strokeWidth: 4 }));
    r.produceBitmap();
    expect(recording!.ops).toContain('ellipse');
    expect(recording!.ops).toContain('fill');
    expect(recording!.ops).toContain('stroke');
    expect(recording!.strokes[0]).toBe('#000');
  });

  test('zero-size returns null without drawing', () => {
    const r = new ShapeRuntime();
    r.mount(makeShape({ w: 0, h: 0 }));
    expect(r.produceBitmap()).toBeNull();
    expect(recording!.ops).toEqual([]);
  });

  test('cache identity: same content yields same bitmap reference', () => {
    const r = new ShapeRuntime();
    r.mount(makeShape({ shape: 'rect', fill: '#f00' }));
    const a = r.produceBitmap();
    const b = r.produceBitmap();
    expect(a).toBe(b);
  });

  test('update with new content changes cache key — fresh bitmap', () => {
    const r = new ShapeRuntime();
    const initial = makeShape({ shape: 'rect', fill: '#f00' });
    r.mount(initial);
    const a = r.produceBitmap();
    const next = { ...initial, fill: '#0f0' };
    r.update(initial, next);
    const b = r.produceBitmap();
    expect(b).not.toBe(a);
  });

  test('unmount drops state — produceBitmap returns null', () => {
    const r = new ShapeRuntime();
    r.mount(makeShape({ fill: '#f00' }));
    r.produceBitmap();
    r.unmount();
    expect(r.produceBitmap()).toBeNull();
  });
});
