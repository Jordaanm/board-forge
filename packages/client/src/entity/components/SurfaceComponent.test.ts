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
import { type SurfaceElement, newElementId } from './SurfaceElement';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { elementBitmapCache } from './ElementBitmapCache';
import type { InputEventPayload } from '../../input/inputEvents';

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let lastRecording: ReturnType<typeof makeRecordingCtx> | null = null;

interface DrawCall { source: unknown; x: number; y: number; }

function makeRecordingCtx(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const ctx: any = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect:  () => {}, fillRect:   () => {}, strokeRect: () => {}, rect:       () => {},
    beginPath:  () => {}, closePath:  () => {}, moveTo:     () => {}, lineTo:     () => {},
    arcTo:      () => {}, arc:        () => {}, ellipse:    () => {},
    fill:       () => {}, stroke:     () => {},
    drawImage:  (source: unknown, x: number, y: number) => { calls.push({ source, x, y }); },
  };
  return { ctx: ctx as CanvasRenderingContext2D, calls };
}

function installRecordingContext(): { calls: DrawCall[] } {
  const rec = makeRecordingCtx();
  lastRecording = rec;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type === '2d') return rec.ctx;
    return null;
  } as any;
  return rec;
}

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  installRecordingContext();
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  lastRecording = null;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
});

interface ShapeSeed {
  id?:         string;
  x?:          number;
  y?:          number;
  w?:          number;
  h?:          number;
  shape?:      'rect' | 'circle';
  fill?:       string;
}

function shapeSeed(seed: ShapeSeed = {}): SurfaceElement {
  return {
    id:    seed.id    ?? newElementId(),
    kind:  'shape',
    shape: seed.shape ?? 'rect',
    x:     seed.x     ?? 0,
    y:     seed.y     ?? 0,
    w:     seed.w     ?? 10,
    h:     seed.h     ?? 10,
    fill:  seed.fill  ?? '#f00',
  };
}

function spawnSurface(opts: {
  canvasSize?: [number, number];
  elements?:   SurfaceElement[];
} = {}): {
  scene:   SceneImpl;
  ctx:     SpawnContext;
  entity:  Entity;
  surface: SurfaceComponent;
} {
  const scene = new SceneImpl();
  const ctx: SpawnContext = {
    scene:       new THREE.Scene(),
    physics:     new PhysicsWorld(),
    entityScene: scene,
  };

  const entity = new Entity({ id: 'parent-1', type: 'sticker', name: 'Sticker' });
  const transform = new TransformComponent();
  transform.fromJSON({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  entity.attachComponent(transform);

  const mesh = new MeshComponent();
  mesh.fromJSON({ meshRef: 'prim:plane', textureRefs: { default: '' }, color: '#ffffff', size: [1, 0.01, 1] });
  entity.attachComponent(mesh);

  const surface = new SurfaceComponent();
  surface.fromJSON({
    canvasSize: opts.canvasSize ?? [256, 256],
    elements:   opts.elements   ?? [],
  });
  entity.attachComponent(surface);

  scene.add(entity);
  transform.onSpawn(ctx);
  mesh.onSpawn(ctx);
  surface.onSpawn(ctx);

  return { scene, ctx, entity, surface };
}

describe('SurfaceComponent — registration', () => {
  test('static metadata', () => {
    expect(SurfaceComponent.typeId).toBe('surface');
    expect(SurfaceComponent.requires).toEqual(['mesh']);
    expect(SurfaceComponent.channel).toBe('reliable');
  });
});

describe('SurfaceComponent — onSpawn / onDespawn', () => {
  test('onSpawn creates a canvas at canvasSize and a CanvasTexture, binds to mesh material map', () => {
    const { surface, entity } = spawnSurface({ canvasSize: [512, 256] });

    expect(surface.canvas).not.toBeNull();
    expect(surface.canvas!.width).toBe(512);
    expect(surface.canvas!.height).toBe(256);
    expect(surface.texture).toBeInstanceOf(THREE.CanvasTexture);

    const mesh = entity.getComponent(MeshComponent)!;
    const child = mesh.group.children[0] as THREE.Mesh;
    const mat = child.material as THREE.MeshLambertMaterial;
    expect(mat.map).toBe(surface.texture);
    expect(mat.userData.surfaceOwned).toBe(true);
  });

  test('onSpawn marks the surface dirty so first compose runs on next drain', () => {
    spawnSurface();
    expect(surfaceRenderQueue.size()).toBe(1);
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);
  });

  test('onSpawn mounts pre-loaded elements', () => {
    const { surface } = spawnSurface({
      elements: [shapeSeed({ id: 'a' })],
    });
    expect(surface.state.elements).toHaveLength(1);
    surface.compose();
    const calls = lastRecording!.calls;
    expect(calls.length).toBe(1);
  });

  test('onDespawn disposes texture, drops canvas, and unbinds from mesh material', () => {
    const { surface, entity, ctx } = spawnSurface();
    const tex = surface.texture!;
    const disposeSpy = vi.spyOn(tex, 'dispose');

    surface.onDespawn(ctx);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(surface.texture).toBeNull();
    expect(surface.canvas).toBeNull();

    const mesh = entity.getComponent(MeshComponent)!;
    const meshChild = mesh.group.children[0] as THREE.Mesh;
    const mat = meshChild.material as THREE.MeshLambertMaterial;
    expect(mat.map).toBeNull();
    expect(mat.userData.surfaceOwned).toBeUndefined();
  });

  test('canvasSize change updates canvas dimensions and re-flips dirty', () => {
    const { surface } = spawnSurface({ canvasSize: [128, 128] });
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);

    surface.setState({ canvasSize: [256, 512] });
    expect(surface.canvas!.width).toBe(256);
    expect(surface.canvas!.height).toBe(512);
    expect(surfaceRenderQueue.size()).toBe(1);
  });
});

describe('SurfaceComponent — element-array diff lifecycle', () => {
  test('addElement appends and mounts; compose draws the new element', () => {
    const { surface } = spawnSurface();
    surfaceRenderQueue.drain();

    surface.addElement(shapeSeed({ id: 'a', x: 5, y: 6, w: 20, h: 20 }));

    expect(surface.state.elements).toHaveLength(1);
    surface.compose();
    const calls = lastRecording!.calls;
    expect(calls.length).toBe(1);
    expect(calls[0].x).toBe(5);
    expect(calls[0].y).toBe(6);
  });

  test('mutateElement updates same-kind element, draws with new bounds', () => {
    const { surface } = spawnSurface({ elements: [shapeSeed({ id: 'a' })] });
    surfaceRenderQueue.drain();
    lastRecording!.calls.length = 0;

    surface.mutateElement('a', { x: 50, y: 60 });

    expect(surfaceRenderQueue.size()).toBe(1);
    surface.compose();
    expect(lastRecording!.calls[0].x).toBe(50);
    expect(lastRecording!.calls[0].y).toBe(60);
  });

  test('removeElement unmounts and removes from array', () => {
    const { surface } = spawnSurface({ elements: [shapeSeed({ id: 'a' })] });
    surfaceRenderQueue.drain();
    lastRecording!.calls.length = 0;

    surface.removeElement('a');

    expect(surface.state.elements).toHaveLength(0);
    expect(surfaceRenderQueue.size()).toBe(1);
    surface.compose();
    expect(lastRecording!.calls.length).toBe(0);
  });

  test('compose iterates state.elements in order', () => {
    const { surface } = spawnSurface({
      elements: [
        shapeSeed({ id: 'a', x: 10, y: 20, w: 50, h: 30 }),
        shapeSeed({ id: 'b', x: 60, y: 80, w: 40, h: 40, shape: 'circle' }),
      ],
    });
    surface.compose();
    const calls = lastRecording!.calls;
    expect(calls.length).toBe(2);
    expect(calls[0].x).toBe(10);
    expect(calls[0].y).toBe(20);
    expect(calls[1].x).toBe(60);
    expect(calls[1].y).toBe(80);
  });

  test('60 Hz tween-style mutateElement collapses to one composition per frame', () => {
    const composeSpy = vi.spyOn(SurfaceComponent.prototype, 'compose');
    const { surface } = spawnSurface({ elements: [shapeSeed({ id: 'a' })] });
    surfaceRenderQueue.drain();
    composeSpy.mockClear();

    for (let i = 0; i < 60; i++) surface.mutateElement('a', { x: i });
    surfaceRenderQueue.drain();
    expect(composeSpy).toHaveBeenCalledTimes(1);

    composeSpy.mockRestore();
  });

  test('applyRemoteState({ elements }) runs the diff: add → mount, remove → unmount', () => {
    const { surface } = spawnSurface({ elements: [shapeSeed({ id: 'a' })] });
    surface.compose();
    expect(lastRecording!.calls.length).toBe(1);
    lastRecording!.calls.length = 0;

    surface.applyRemoteState({ elements: [
      shapeSeed({ id: 'b' }),
      shapeSeed({ id: 'c' }),
    ]});

    surface.compose();
    // Compose now runs against the new array — exactly two draws (the two new
    // elements). 'a' was unmounted, no longer rendered.
    expect(lastRecording!.calls.length).toBe(2);
  });

  test('mutating different-kind: unmount + mount fresh runtime', () => {
    const { surface } = spawnSurface({ elements: [shapeSeed({ id: 'a' })] });
    surface.compose();
    expect(lastRecording!.calls.length).toBe(1);
    lastRecording!.calls.length = 0;

    // Replace 'a' with a rich-kind entry of the same id.
    surface.applyRemoteState({ elements: [
      { id: 'a', kind: 'rich', x: 0, y: 0, w: 10, h: 10, html: '<div/>' },
    ]});
    expect(surface.state.elements[0].kind).toBe('rich');
    // RichRuntime returns null while async render pending — compose draws 0
    // bitmaps, but the runtime swap happened.
    surface.compose();
    expect(lastRecording!.calls.length).toBe(0);
  });
});

describe('SurfaceComponent — press/click forwarding', () => {
  function recordEventsOn(surface: SurfaceComponent, id: string, names: readonly string[] = ['pressed', 'released', 'click']): { name: string; payload: unknown }[] {
    const events: { name: string; payload: unknown }[] = [];
    for (const n of names) surface.addElementListener(id, n, (p) => events.push({ name: n, payload: p }));
    return events;
  }
  function mkPayload(uv?: { u: number; v: number }): InputEventPayload {
    const p: InputEventPayload = { seat: 0, shiftKey: false, ctrlKey: false, altKey: false };
    if (uv) p.surfaceUV = uv;
    return p;
  }

  test('UV → pixel resolves to the correct element id; payload carries surfaceUV + pixel', () => {
    const { surface } = spawnSurface({
      canvasSize: [200, 100],
      elements: [
        shapeSeed({ id: 'a', x: 0,   y: 0, w: 100, h: 100 }),
        shapeSeed({ id: 'b', x: 100, y: 0, w: 100, h: 100 }),
      ],
    });
    const aEv = recordEventsOn(surface, 'a');
    const bEv = recordEventsOn(surface, 'b');

    surface.onClick(mkPayload({ u: 0.25, v: 0.5 }));
    expect(aEv.map(e => e.name)).toEqual(['click']);
    expect(bEv).toEqual([]);
    const payload = aEv[0].payload as { surfaceUV: unknown; pixel: unknown; seat: number };
    expect(payload.surfaceUV).toEqual({ u: 0.25, v: 0.5 });
    expect(payload.pixel).toEqual({ x: 50, y: 50 });
    expect(payload.seat).toBe(0);
  });

  test('reverse z-order: later element wins when bounds overlap', () => {
    const { surface } = spawnSurface({
      canvasSize: [100, 100],
      elements: [
        shapeSeed({ id: 'bottom', x: 0, y: 0, w: 100, h: 100 }),
        shapeSeed({ id: 'top',    x: 0, y: 0, w: 100, h: 100 }),
      ],
    });
    const bottomEv = recordEventsOn(surface, 'bottom');
    const topEv    = recordEventsOn(surface, 'top');

    surface.onClick(mkPayload({ u: 0.5, v: 0.5 }));
    expect(topEv.map(e => e.name)).toEqual(['click']);
    expect(bottomEv).toEqual([]);
  });

  test('miss (UV outside every element) leaves the event on the surface', () => {
    const { surface } = spawnSurface({
      canvasSize: [200, 200],
      elements: [shapeSeed({ id: 'a', x: 0, y: 0, w: 50, h: 50 })],
    });
    const aEv = recordEventsOn(surface, 'a');

    surface.onClick(mkPayload({ u: 0.9, v: 0.9 }));
    expect(aEv).toEqual([]);
  });

  test('payload without surfaceUV is a no-op', () => {
    const { surface } = spawnSurface({
      elements: [shapeSeed({ id: 'a', x: 0, y: 0, w: 50, h: 50 })],
    });
    const aEv = recordEventsOn(surface, 'a');
    surface.onClick(mkPayload());
    expect(aEv).toEqual([]);
  });

  test('press / released / click all forward identically', () => {
    const { surface } = spawnSurface({
      elements: [shapeSeed({ id: 'a', x: 0, y: 0, w: 200, h: 200 })],
    });
    const aEv = recordEventsOn(surface, 'a');
    const payload = mkPayload({ u: 0.5, v: 0.5 });
    surface.onPress   (payload);
    surface.onReleased(payload);
    surface.onClick   (payload);
    expect(aEv.map(e => e.name)).toEqual(['pressed', 'released', 'click']);
  });
});

describe('SurfaceComponent — hover forwarding', () => {
  function recordEventsOn(surface: SurfaceComponent, id: string, names: readonly string[] = ['hover-start', 'hover-move', 'hover-end']): { name: string; payload: unknown }[] {
    const events: { name: string; payload: unknown }[] = [];
    for (const n of names) surface.addElementListener(id, n, (p) => events.push({ name: n, payload: p }));
    return events;
  }
  function mkPayload(uv?: { u: number; v: number }): InputEventPayload {
    const p: InputEventPayload = { seat: 0, shiftKey: false, ctrlKey: false, altKey: false };
    if (uv) p.surfaceUV = uv;
    return p;
  }

  test('hover-start dispatches hover-start on the resolved element id', () => {
    const { surface } = spawnSurface({
      canvasSize: [200, 100],
      elements: [
        shapeSeed({ id: 'a', x: 0,   y: 0, w: 100, h: 100 }),
        shapeSeed({ id: 'b', x: 100, y: 0, w: 100, h: 100 }),
      ],
    });
    const aEv = recordEventsOn(surface, 'a');
    const bEv = recordEventsOn(surface, 'b');
    surface.onHoverStart(mkPayload({ u: 0.25, v: 0.5 }));
    expect(aEv.map(e => e.name)).toEqual(['hover-start']);
    expect(bEv).toEqual([]);
  });

  test('hover-move on same element dispatches hover-move on the same id', () => {
    const { surface } = spawnSurface({
      elements: [shapeSeed({ id: 'a', x: 0, y: 0, w: 256, h: 256 })],
    });
    const ev = recordEventsOn(surface, 'a');
    surface.onHoverStart(mkPayload({ u: 0.25, v: 0.25 }));
    surface.onHoverMove (mkPayload({ u: 0.50, v: 0.50 }));
    expect(ev.map(e => e.name)).toEqual(['hover-start', 'hover-move']);
  });

  test('crossing elements: hover-end on previous BEFORE hover-start on new', () => {
    const { surface } = spawnSurface({
      canvasSize: [200, 100],
      elements: [
        shapeSeed({ id: 'a', x: 0,   y: 0, w: 100, h: 100 }),
        shapeSeed({ id: 'b', x: 100, y: 0, w: 100, h: 100 }),
      ],
    });
    const sequence: string[] = [];
    surface.addElementListener('a', 'hover-end',   () => sequence.push('a:hover-end'));
    surface.addElementListener('a', 'hover-start', () => sequence.push('a:hover-start'));
    surface.addElementListener('b', 'hover-end',   () => sequence.push('b:hover-end'));
    surface.addElementListener('b', 'hover-start', () => sequence.push('b:hover-start'));

    surface.onHoverStart(mkPayload({ u: 0.25, v: 0.5 }));
    surface.onHoverMove (mkPayload({ u: 0.75, v: 0.5 }));
    expect(sequence).toEqual(['a:hover-start', 'a:hover-end', 'b:hover-start']);
  });

  test('surface hover-end fires hover-end on the last element id and clears tracking', () => {
    const { surface } = spawnSurface({
      elements: [shapeSeed({ id: 'a', x: 0, y: 0, w: 256, h: 256 })],
    });
    const ev = recordEventsOn(surface, 'a');
    surface.onHoverStart(mkPayload({ u: 0.5, v: 0.5 }));
    surface.onHoverEnd  (mkPayload());
    expect(ev.map(e => e.name)).toEqual(['hover-start', 'hover-end']);
    surface.onHoverEnd(mkPayload());
    expect(ev.map(e => e.name)).toEqual(['hover-start', 'hover-end']);
  });

  test('hover-move into element gap fires hover-end on previous, no hover-start', () => {
    const { surface } = spawnSurface({
      canvasSize: [200, 100],
      elements: [
        shapeSeed({ id: 'a', x: 0,   y: 0, w: 50, h: 50 }),
        shapeSeed({ id: 'b', x: 100, y: 0, w: 50, h: 50 }),
      ],
    });
    const aEv = recordEventsOn(surface, 'a');
    const bEv = recordEventsOn(surface, 'b');
    surface.onHoverStart(mkPayload({ u: 0.1, v: 0.1 }));
    surface.onHoverMove (mkPayload({ u: 0.4, v: 0.5 }));
    expect(aEv.map(e => e.name)).toEqual(['hover-start', 'hover-end']);
    expect(bEv).toEqual([]);
  });
});

describe('SurfaceComponent — save/load round-trip', () => {
  test('toJSON → fromJSON preserves canvasSize + elements', () => {
    const surface = new SurfaceComponent();
    surface.fromJSON({
      canvasSize: [320, 480],
      elements: [
        { id: 'a', kind: 'shape', shape: 'rect',   x: 0, y: 0, w: 10, h: 10, fill: '#f00' },
        { id: 'b', kind: 'image', x: 5, y: 5, w: 20, h: 30, textureRef: 'base:tex/x', fit: 'cover' },
        { id: 'c', kind: 'rich',  x: 1, y: 2, w: 99, h: 99, html: '<i/>' },
      ],
    });
    const json = surface.toJSON();
    const fresh = new SurfaceComponent();
    fresh.fromJSON(json);
    expect(fresh.toJSON()).toEqual(json);
    expect((fresh.state.elements as SurfaceElement[])[0].id).toBe('a');
    expect((fresh.state.elements as SurfaceElement[])[1].kind).toBe('image');
  });
});
