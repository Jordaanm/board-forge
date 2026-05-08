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
import { ShapeElement } from './ShapeElement';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { elementBitmapCache } from './ElementBitmapCache';
import type { InputEventPayload } from '../../input/inputEvents';

// jsdom does not ship a 2D rasteriser. We install a recording stub on the
// canvas prototype so SurfaceComponent.onSpawn gets a non-null ctx and we
// can verify drawImage calls.
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

function spawnSurfaceTree(opts: {
  canvasSize?: [number, number];
  shapes?: Array<{ id: string; state: any }>;
} = {}): {
  scene:    SceneImpl;
  ctx:      SpawnContext;
  parent:   Entity;
  surface:  SurfaceComponent;
  elements: ShapeElement[];
} {
  const scene = new SceneImpl();
  const ctx: SpawnContext = {
    scene:       new THREE.Scene(),
    physics:     new PhysicsWorld(),
    entityScene: scene,
  };

  const parent = new Entity({ id: 'parent-1', type: 'sticker', name: 'Sticker' });
  const transform = new TransformComponent();
  transform.fromJSON({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  parent.attachComponent(transform);

  const mesh = new MeshComponent();
  mesh.fromJSON({ meshRef: 'prim:plane', textureRefs: { default: '' }, tint: '#ffffff', size: [1, 0.01, 1] });
  parent.attachComponent(mesh);

  const surface = new SurfaceComponent();
  surface.fromJSON({ canvasSize: opts.canvasSize ?? [256, 256] });
  parent.attachComponent(surface);

  scene.add(parent);
  transform.onSpawn(ctx);
  mesh.onSpawn(ctx);
  surface.onSpawn(ctx);

  const elements: ShapeElement[] = [];
  for (const s of opts.shapes ?? []) {
    const child = new Entity({ id: s.id, type: 'shape-element', name: 'Shape', parentId: parent.id });
    parent.children.push(child.id);
    const el = new ShapeElement();
    el.fromJSON(s.state);
    child.attachComponent(el);
    scene.add(child);
    el.onSpawn(ctx);
    elements.push(el);
  }

  return { scene, ctx, parent, surface, elements };
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
    const { surface, parent } = spawnSurfaceTree({ canvasSize: [512, 256] });

    expect(surface.canvas).not.toBeNull();
    expect(surface.canvas!.width).toBe(512);
    expect(surface.canvas!.height).toBe(256);
    expect(surface.texture).toBeInstanceOf(THREE.CanvasTexture);

    const mesh = parent.getComponent(MeshComponent)!;
    const child = mesh.group.children[0] as THREE.Mesh;
    const mat = child.material as THREE.MeshLambertMaterial;
    expect(mat.map).toBe(surface.texture);
    expect(mat.userData.surfaceOwned).toBe(true);
  });

  test('onSpawn marks the surface dirty so first compose runs on next drain', () => {
    const { surface } = spawnSurfaceTree();
    expect(surfaceRenderQueue.size()).toBe(1);
    expect(surfaceRenderQueue.size()).toBe(1);
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);
    // sanity: surface still spawned
    expect(surface.canvas).not.toBeNull();
  });

  test('onDespawn disposes texture, drops canvas, and unbinds from mesh material', () => {
    const { surface, parent, ctx } = spawnSurfaceTree();
    const tex = surface.texture!;
    const disposeSpy = vi.spyOn(tex, 'dispose');

    surface.onDespawn(ctx);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(surface.texture).toBeNull();
    expect(surface.canvas).toBeNull();

    const mesh = parent.getComponent(MeshComponent)!;
    const meshChild = mesh.group.children[0] as THREE.Mesh;
    const mat = meshChild.material as THREE.MeshLambertMaterial;
    expect(mat.map).toBeNull();
    expect(mat.userData.surfaceOwned).toBeUndefined();
  });

  test('canvasSize change updates canvas dimensions and re-flips dirty', () => {
    const { surface } = spawnSurfaceTree({ canvasSize: [128, 128] });
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);

    surface.setState({ canvasSize: [256, 512] });
    expect(surface.canvas!.width).toBe(256);
    expect(surface.canvas!.height).toBe(512);
    expect(surfaceRenderQueue.size()).toBe(1);
  });
});

describe('SurfaceComponent — composition', () => {
  test('compose walks entity.children in order and blits each element bitmap at its bounds', () => {
    const { surface } = spawnSurfaceTree({
      shapes: [
        { id: 's1', state: { x: 10, y: 20, w: 50, h: 30, kind: 'rect',   fill: '#f00' } },
        { id: 's2', state: { x: 60, y: 80, w: 40, h: 40, kind: 'circle', fill: '#0f0' } },
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

  test('element setState flips parent surface dirty exactly once per change', () => {
    const { elements } = spawnSurfaceTree({
      shapes: [{ id: 's1', state: { x: 0, y: 0, w: 10, h: 10, kind: 'rect', fill: '#f00' } }],
    });

    surfaceRenderQueue.drain(); // clear initial dirty
    expect(surfaceRenderQueue.size()).toBe(0);

    elements[0].setState({ x: 5 });
    expect(surfaceRenderQueue.size()).toBe(1);
  });

  test('60 Hz tween-style setState collapses to one composition per frame', () => {
    const composeSpy = vi.spyOn(SurfaceComponent.prototype, 'compose');

    const { elements } = spawnSurfaceTree({
      shapes: [{ id: 's1', state: { x: 0, y: 0, w: 10, h: 10, kind: 'rect', fill: '#f00' } }],
    });

    surfaceRenderQueue.drain(); // initial dirty
    composeSpy.mockClear();

    // 60 mutations between drains → 1 compose call.
    for (let i = 0; i < 60; i++) elements[0].setState({ x: i });
    surfaceRenderQueue.drain();
    expect(composeSpy).toHaveBeenCalledTimes(1);

    composeSpy.mockRestore();
  });

  test('despawned element flips parent surface dirty', () => {
    const { elements, ctx } = spawnSurfaceTree({
      shapes: [{ id: 's1', state: { x: 0, y: 0, w: 10, h: 10, kind: 'rect', fill: '#f00' } }],
    });
    surfaceRenderQueue.drain();
    expect(surfaceRenderQueue.size()).toBe(0);

    elements[0].onDespawn(ctx);
    expect(surfaceRenderQueue.size()).toBe(1);
  });
});

describe('SurfaceComponent — press/click forwarding (issue #4)', () => {
  function recordEvents(e: Entity, names: readonly string[] = ['pressed', 'released', 'click']) {
    const events: { name: string; payload: unknown }[] = [];
    for (const n of names) e.addEventListener(n, (p) => events.push({ name: n, payload: p }));
    return events;
  }
  function mkPayload(uv?: { u: number; v: number }): InputEventPayload {
    const p: InputEventPayload = { seat: 0, shiftKey: false, ctrlKey: false, altKey: false };
    if (uv) p.surfaceUV = uv;
    return p;
  }

  test('UV → pixel resolves to the correct child element; payload carries surfaceUV + pixel', () => {
    const tree = spawnSurfaceTree({
      canvasSize: [200, 100],
      shapes: [
        { id: 'a', state: { x: 0,   y: 0, w: 100, h: 100, kind: 'rect', fill: '#f00' } },
        { id: 'b', state: { x: 100, y: 0, w: 100, h: 100, kind: 'rect', fill: '#0f0' } },
      ],
    });
    const a = tree.scene.getEntity('a')!;
    const b = tree.scene.getEntity('b')!;
    const aEv = recordEvents(a);
    const bEv = recordEvents(b);

    // uv (0.25, 0.5) → pixel (50, 50) — inside element 'a'.
    tree.surface.onClick(mkPayload({ u: 0.25, v: 0.5 }));
    expect(aEv.map(e => e.name)).toEqual(['click']);
    expect(bEv).toEqual([]);
    const payload = aEv[0].payload as { surfaceUV: unknown; pixel: unknown; seat: number };
    expect(payload.surfaceUV).toEqual({ u: 0.25, v: 0.5 });
    expect(payload.pixel).toEqual({ x: 50, y: 50 });
    expect(payload.seat).toBe(0);
  });

  test('reverse z-order: later child wins when bounds overlap', () => {
    const tree = spawnSurfaceTree({
      canvasSize: [100, 100],
      shapes: [
        { id: 'bottom', state: { x: 0, y: 0, w: 100, h: 100, kind: 'rect', fill: '#f00' } },
        { id: 'top',    state: { x: 0, y: 0, w: 100, h: 100, kind: 'rect', fill: '#0f0' } },
      ],
    });
    const bottom = tree.scene.getEntity('bottom')!;
    const top    = tree.scene.getEntity('top')!;
    const bottomEv = recordEvents(bottom);
    const topEv    = recordEvents(top);

    tree.surface.onClick(mkPayload({ u: 0.5, v: 0.5 }));
    expect(topEv.map(e => e.name)).toEqual(['click']);
    expect(bottomEv).toEqual([]);
  });

  test('miss (UV outside every element) leaves the event on the surface', () => {
    const tree = spawnSurfaceTree({
      canvasSize: [200, 200],
      shapes: [
        { id: 'a', state: { x: 0, y: 0, w: 50, h: 50, kind: 'rect', fill: '#f00' } },
      ],
    });
    const a = tree.scene.getEntity('a')!;
    const aEv = recordEvents(a);

    // uv (0.9, 0.9) → pixel (180, 180) — outside element 'a'.
    tree.surface.onClick(mkPayload({ u: 0.9, v: 0.9 }));
    expect(aEv).toEqual([]);
    // Surface entity's own listeners (the dispatcher fired these before the
    // forwarding hook ran) are unaffected — onClick simply did not forward.
  });

  test('payload without surfaceUV is a no-op (no element dispatch)', () => {
    const tree = spawnSurfaceTree({
      shapes: [{ id: 'a', state: { x: 0, y: 0, w: 50, h: 50, kind: 'rect', fill: '#f00' } }],
    });
    const a = tree.scene.getEntity('a')!;
    const aEv = recordEvents(a);

    tree.surface.onClick(mkPayload());
    expect(aEv).toEqual([]);
  });

  test('press / released / click all forward identically', () => {
    const tree = spawnSurfaceTree({
      shapes: [{ id: 'a', state: { x: 0, y: 0, w: 200, h: 200, kind: 'rect', fill: '#f00' } }],
    });
    const a = tree.scene.getEntity('a')!;
    const aEv = recordEvents(a);

    const payload = mkPayload({ u: 0.5, v: 0.5 });
    tree.surface.onPress(payload);
    tree.surface.onReleased(payload);
    tree.surface.onClick(payload);
    expect(aEv.map(e => e.name)).toEqual(['pressed', 'released', 'click']);
  });

  test('forward does NOT route through World.fireInputEvent (local-only re-fire)', () => {
    // The element entity's bus must have received exactly one dispatch — if
    // the surface re-routed through fireInputEvent (which on a guest also
    // emits a guest-input-event RPC), that would re-enter the bus once more
    // via the host inbound path. Here we simply verify the re-fire goes
    // through entity.dispatchEvent directly, not through any world hook.
    const tree = spawnSurfaceTree({
      canvasSize: [200, 200],
      shapes: [{ id: 'a', state: { x: 0, y: 0, w: 200, h: 200, kind: 'rect', fill: '#f00' } }],
    });
    const a = tree.scene.getEntity('a')!;
    let calls = 0;
    a.addEventListener('click', () => calls++);
    tree.surface.onClick(mkPayload({ u: 0.5, v: 0.5 }));
    expect(calls).toBe(1);
  });
});

describe('SurfaceComponent — hover forwarding (issue #5)', () => {
  function recordEvents(e: Entity, names: readonly string[] = ['hover-start', 'hover-move', 'hover-end']) {
    const events: { name: string; payload: unknown }[] = [];
    for (const n of names) e.addEventListener(n, (p) => events.push({ name: n, payload: p }));
    return events;
  }
  function mkPayload(uv?: { u: number; v: number }): InputEventPayload {
    const p: InputEventPayload = { seat: 0, shiftKey: false, ctrlKey: false, altKey: false };
    if (uv) p.surfaceUV = uv;
    return p;
  }

  test('hover-start dispatches hover-start on the resolved element', () => {
    const tree = spawnSurfaceTree({
      canvasSize: [200, 100],
      shapes: [
        { id: 'a', state: { x: 0,   y: 0, w: 100, h: 100, kind: 'rect', fill: '#f00' } },
        { id: 'b', state: { x: 100, y: 0, w: 100, h: 100, kind: 'rect', fill: '#0f0' } },
      ],
    });
    const a = tree.scene.getEntity('a')!;
    const b = tree.scene.getEntity('b')!;
    const aEv = recordEvents(a);
    const bEv = recordEvents(b);

    tree.surface.onHoverStart(mkPayload({ u: 0.25, v: 0.5 }));
    expect(aEv.map(e => e.name)).toEqual(['hover-start']);
    expect(bEv).toEqual([]);
  });

  test('hover-move on same element dispatches hover-move on the element', () => {
    const tree = spawnSurfaceTree({
      shapes: [{ id: 'a', state: { x: 0, y: 0, w: 256, h: 256, kind: 'rect', fill: '#f00' } }],
    });
    const a  = tree.scene.getEntity('a')!;
    const ev = recordEvents(a);

    tree.surface.onHoverStart(mkPayload({ u: 0.25, v: 0.25 }));
    tree.surface.onHoverMove (mkPayload({ u: 0.50, v: 0.50 }));
    expect(ev.map(e => e.name)).toEqual(['hover-start', 'hover-move']);
  });

  test('crossing elements: hover-end on previous fires BEFORE hover-start on new', () => {
    const tree = spawnSurfaceTree({
      canvasSize: [200, 100],
      shapes: [
        { id: 'a', state: { x: 0,   y: 0, w: 100, h: 100, kind: 'rect', fill: '#f00' } },
        { id: 'b', state: { x: 100, y: 0, w: 100, h: 100, kind: 'rect', fill: '#0f0' } },
      ],
    });
    const a = tree.scene.getEntity('a')!;
    const b = tree.scene.getEntity('b')!;
    const sequence: string[] = [];
    a.addEventListener('hover-end',   () => sequence.push('a:hover-end'));
    a.addEventListener('hover-start', () => sequence.push('a:hover-start'));
    b.addEventListener('hover-end',   () => sequence.push('b:hover-end'));
    b.addEventListener('hover-start', () => sequence.push('b:hover-start'));

    tree.surface.onHoverStart(mkPayload({ u: 0.25, v: 0.5 })); // → 'a'
    tree.surface.onHoverMove (mkPayload({ u: 0.75, v: 0.5 })); // → 'b'
    expect(sequence).toEqual(['a:hover-start', 'a:hover-end', 'b:hover-start']);
  });

  test('surface hover-end fires hover-end on the last hovered element and clears tracking', () => {
    const tree = spawnSurfaceTree({
      shapes: [{ id: 'a', state: { x: 0, y: 0, w: 256, h: 256, kind: 'rect', fill: '#f00' } }],
    });
    const a  = tree.scene.getEntity('a')!;
    const ev = recordEvents(a);

    tree.surface.onHoverStart(mkPayload({ u: 0.5, v: 0.5 }));
    tree.surface.onHoverEnd  (mkPayload());
    expect(ev.map(e => e.name)).toEqual(['hover-start', 'hover-end']);

    // Subsequent hover-end with no current element is a no-op.
    tree.surface.onHoverEnd(mkPayload());
    expect(ev.map(e => e.name)).toEqual(['hover-start', 'hover-end']);
  });

  test('hover-move into element gap fires hover-end on previous, no hover-start', () => {
    const tree = spawnSurfaceTree({
      canvasSize: [200, 100],
      shapes: [
        { id: 'a', state: { x: 0,   y: 0, w: 50, h: 50, kind: 'rect', fill: '#f00' } },
        { id: 'b', state: { x: 100, y: 0, w: 50, h: 50, kind: 'rect', fill: '#0f0' } },
      ],
    });
    const a = tree.scene.getEntity('a')!;
    const b = tree.scene.getEntity('b')!;
    const aEv = recordEvents(a);
    const bEv = recordEvents(b);

    tree.surface.onHoverStart(mkPayload({ u: 0.1,  v: 0.1 })); // (20, 10) → 'a'
    tree.surface.onHoverMove (mkPayload({ u: 0.4,  v: 0.5 })); // (80, 50) → gap
    expect(aEv.map(e => e.name)).toEqual(['hover-start', 'hover-end']);
    expect(bEv).toEqual([]);
  });
});

describe('SurfaceComponent — save/load round-trip', () => {
  test('toJSON → fromJSON preserves canvasSize', () => {
    const surface = new SurfaceComponent();
    surface.fromJSON({ canvasSize: [320, 480] });
    const json = surface.toJSON();
    const fresh = new SurfaceComponent();
    fresh.fromJSON(json);
    expect(fresh.toJSON()).toEqual({ canvasSize: [320, 480] });
  });
});
