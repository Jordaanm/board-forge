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
