// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Entity } from '../Entity';
import { ShapeElement } from './ShapeElement';
import { elementBitmapCache } from './ElementBitmapCache';
import { surfaceRenderQueue } from './SurfaceRenderQueue';

interface CtxRecording {
  ops:    string[];
  fills:  string[];
  strokes: string[];
}

function installRecordingCtx(): CtxRecording {
  const rec: CtxRecording = { ops: [], fills: [], strokes: [] };
  const ctx: any = new Proxy({
    fillStyle:   '',
    strokeStyle: '',
    lineWidth:   1,
  }, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      return (...args: unknown[]) => {
        rec.ops.push(`${String(prop)}(${args.join(',')})`);
        if (prop === 'fill')   rec.fills.push(target.fillStyle);
        if (prop === 'stroke') rec.strokes.push(target.strokeStyle);
      };
    },
    set(target, prop, value) {
      (target as any)[prop] = value;
      return true;
    },
  });

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type === '2d') return ctx;
    return null;
  } as any;
  return rec;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  elementBitmapCache.clear();
  surfaceRenderQueue.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  elementBitmapCache.clear();
  surfaceRenderQueue.clear();
});

describe('ShapeElement — registration', () => {
  test('static metadata', () => {
    expect(ShapeElement.typeId).toBe('shape-element');
    expect(ShapeElement.requires).toEqual([]);
  });
});

describe('ShapeElement — produceBitmap', () => {
  test('rect: draws fill + stroke + corner-radius via Canvas2D', () => {
    const rec = installRecordingCtx();
    const e = new Entity({ id: 'e1', type: 'shape-element', name: 'Shape' });
    const el = new ShapeElement();
    el.fromJSON({ x: 0, y: 0, w: 80, h: 40, kind: 'rect', fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 4 });
    e.attachComponent(el);

    const bitmap = el.produceBitmap();
    expect(bitmap).not.toBeNull();
    expect(rec.fills).toContain('#ff0000');
    expect(rec.strokes).toContain('#000000');
    expect(rec.ops.some((op) => op.startsWith('arcTo('))).toBe(true);
  });

  test('circle: draws ellipse with fill + stroke', () => {
    const rec = installRecordingCtx();
    const e = new Entity({ id: 'e2', type: 'shape-element', name: 'Shape' });
    const el = new ShapeElement();
    el.fromJSON({ x: 0, y: 0, w: 50, h: 50, kind: 'circle', fill: '#00ff00', stroke: '#0000ff', strokeWidth: 1 });
    e.attachComponent(el);

    el.produceBitmap();
    expect(rec.ops.some((op) => op.startsWith('ellipse('))).toBe(true);
    expect(rec.fills).toContain('#00ff00');
    expect(rec.strokes).toContain('#0000ff');
  });

  test('zero-size produces no bitmap', () => {
    installRecordingCtx();
    const e = new Entity({ id: 'e3', type: 'shape-element', name: 'Shape' });
    const el = new ShapeElement();
    el.fromJSON({ x: 0, y: 0, w: 0, h: 10, kind: 'rect', fill: '#fff' });
    e.attachComponent(el);
    expect(el.produceBitmap()).toBeNull();
  });

  test('repeat call returns the cached bitmap (same reference)', () => {
    installRecordingCtx();
    const e = new Entity({ id: 'e4', type: 'shape-element', name: 'Shape' });
    const el = new ShapeElement();
    el.fromJSON({ x: 0, y: 0, w: 10, h: 10, kind: 'rect', fill: '#abc' });
    e.attachComponent(el);

    const a = el.produceBitmap();
    const b = el.produceBitmap();
    expect(a).toBe(b);
  });

  test('state change yields a different cache key (and a new bitmap)', () => {
    installRecordingCtx();
    const e = new Entity({ id: 'e5', type: 'shape-element', name: 'Shape' });
    const el = new ShapeElement();
    el.fromJSON({ x: 0, y: 0, w: 10, h: 10, kind: 'rect', fill: '#abc' });
    e.attachComponent(el);

    const a = el.produceBitmap();
    el.state.fill = '#def';
    const b = el.produceBitmap();
    expect(a).not.toBe(b);
  });
});

describe('ShapeElement — round-trip', () => {
  test('toJSON → fromJSON identity', () => {
    const el = new ShapeElement();
    el.fromJSON({ x: 1, y: 2, w: 3, h: 4, kind: 'rect', fill: '#fff', stroke: '#000', strokeWidth: 2, radius: 1 });
    const fresh = new ShapeElement();
    fresh.fromJSON(el.toJSON());
    expect(fresh.toJSON()).toEqual(el.toJSON());
  });
});
