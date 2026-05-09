// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Entity } from '../Entity';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';
import { SurfaceComponent } from './SurfaceComponent';
import { ShapeElement } from './ShapeElement';
import { ImageElement } from './ImageElement';
import { RichElement } from './RichElement';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { elementBitmapCache } from './ElementBitmapCache';
import { attachSticker, createSurfaceChild, createSurfaceElement } from './attachSticker';

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // Stub canvas 2d for SurfaceComponent.onSpawn.
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === '2d') {
      return {
        fillStyle: '', strokeStyle: '', lineWidth: 1,
        clearRect: () => {}, fillRect: () => {}, strokeRect: () => {}, rect: () => {},
        beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
        arcTo: () => {}, arc: () => {}, ellipse: () => {},
        fill: () => {}, stroke: () => {}, drawImage: () => {},
      } as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as any;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  surfaceRenderQueue.clear();
  elementBitmapCache.clear();
});

function makeParent(scene: SceneImpl, ctx: SpawnContext, halfExtents: [number, number, number] = [1, 0.5, 1.5]): Entity {
  const parent = new Entity({ id: 'parent-1', type: 'token', name: 'Token' });
  const transform = new TransformComponent();
  transform.fromJSON({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  parent.attachComponent(transform);
  const mesh = new MeshComponent();
  mesh.fromJSON({
    meshRef:     'prim:cube',
    textureRefs: { default: '' },
    tint:        '#888',
    size:        [halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2],
  });
  parent.attachComponent(mesh);
  scene.add(parent);
  transform.onSpawn(ctx);
  mesh.onSpawn(ctx);
  return parent;
}

function makeCtx(scene: SceneImpl): SpawnContext {
  return { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };
}

describe('attachSticker — entity tree shape', () => {
  test('creates surface entity (transform + mesh + surface) and element entity, parented correctly', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);

    const { surface, element } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect', fill: '#f00' } },
    });

    expect(surface.parentId).toBe(parent.id);
    expect(parent.children).toContain(surface.id);
    expect(surface.getComponent(TransformComponent)).toBeDefined();
    expect(surface.getComponent(MeshComponent)).toBeDefined();
    expect(surface.getComponent(SurfaceComponent)).toBeDefined();
    expect(surface.getComponent(MeshComponent)!.state.meshRef).toBe('prim:plane');

    expect(element.parentId).toBe(surface.id);
    expect(surface.children).toContain(element.id);
    expect(element.getComponent(ShapeElement)).toBeDefined();
  });

  test('html opt creates a RichElement', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { element } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { html: '<div>hi</div>' },
    });
    expect(element.getComponent(RichElement)).toBeDefined();
    expect(element.getComponent(RichElement)!.state.html).toBe('<div>hi</div>');
  });

  test('image opt creates an ImageElement carrying the textureRef + fit', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { element } = attachSticker(scene, ctx, parent, {
      face:    'front',
      content: { image: 'base:tex/portrait', fit: 'cover' },
    });
    const img = element.getComponent(ImageElement)!;
    expect(img.state.textureRef).toBe('base:tex/portrait');
    expect(img.state.fit).toBe('cover');
  });

  test('throws when parent has no MeshComponent', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = new Entity({ id: 'no-mesh', type: 'token', name: 'NoMesh' });
    scene.add(parent);
    expect(() => attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect' } },
    })).toThrow();
  });
});

describe('attachSticker — face math', () => {
  test('top: surface positioned at +halfHeightY with quaternion rotating +Z to +Y', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [1, 0.5, 1.5]);
    const { surface } = attachSticker(scene, ctx, parent, {
      face:    'top',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const t = surface.getComponent(TransformComponent)!;
    expect(t.state.position[1]).toBeCloseTo(0.5, 5);
    // Rotate (0,0,1) by the quaternion → expect (0,1,0).
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...t.state.rotation));
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(1, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  test('front: identity rotation, position at +hz', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [1, 0.5, 1.5]);
    const { surface } = attachSticker(scene, ctx, parent, {
      face:    'front',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const t = surface.getComponent(TransformComponent)!;
    expect(t.state.position[2]).toBeCloseTo(1.5, 5);
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...t.state.rotation));
    expect(v.z).toBeCloseTo(1, 5);
  });

  test('right: position at +hx, +Z rotates to +X', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [2, 0.5, 1]);
    const { surface } = attachSticker(scene, ctx, parent, {
      face:    'right',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const t = surface.getComponent(TransformComponent)!;
    expect(t.state.position[0]).toBeCloseTo(2, 5);
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...t.state.rotation));
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  test('default offset pushes the surface slightly off the face to avoid z-fight', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [1, 0.5, 1]);
    const { surface } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect' } },
    });
    const y = surface.getComponent(TransformComponent)!.state.position[1];
    expect(y).toBeGreaterThan(0.5);
    expect(y - 0.5).toBeLessThan(0.01);
  });
});

describe('createSurfaceChild', () => {
  test('creates a surface entity (transform + plane mesh + surface) parented to the parent, no element child', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);

    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });

    expect(surface.parentId).toBe(parent.id);
    expect(parent.children).toContain(surface.id);
    expect(surface.getComponent(TransformComponent)).toBeDefined();
    expect(surface.getComponent(MeshComponent)!.state.meshRef).toBe('prim:plane');
    expect(surface.getComponent(SurfaceComponent)).toBeDefined();
    expect(surface.children).toEqual([]);
  });

  test('default size covers the parent face (top → [hx*2, hz*2])', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [1, 0.5, 1.5]);

    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });

    const meshSize = surface.getComponent(MeshComponent)!.state.size as [number, number, number];
    expect(meshSize[0]).toBeCloseTo(2, 5);
    expect(meshSize[2]).toBeCloseTo(3, 5);
  });

  test('throws when parent has no MeshComponent', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = new Entity({ id: 'no-mesh', type: 'token', name: 'NoMesh' });
    scene.add(parent);
    expect(() => createSurfaceChild(scene, ctx, parent, { face: 'top' })).toThrow();
  });

  test('omitting face defaults to top', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [1, 0.5, 1]);
    const surface = createSurfaceChild(scene, ctx, parent, {});
    const t = surface.getComponent(TransformComponent)!;
    expect(t.state.position[1]).toBeGreaterThan(0.5);
  });
});

describe('createSurfaceElement', () => {
  test('shape-rect kind spawns a ShapeElement child of the surface, sized to canvas', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top', canvasSize: [256, 128] });

    const element = createSurfaceElement(scene, ctx, surface, 'shape-rect');

    expect(element.parentId).toBe(surface.id);
    expect(surface.children).toContain(element.id);
    const shape = element.getComponent(ShapeElement)!;
    expect(shape).toBeDefined();
    expect(shape.state.kind).toBe('rect');
    expect(shape.state.w).toBe(256);
    expect(shape.state.h).toBe(128);
  });

  test('shape-circle kind sets ShapeKind to circle', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    const element = createSurfaceElement(scene, ctx, surface, 'shape-circle');
    expect(element.getComponent(ShapeElement)!.state.kind).toBe('circle');
  });

  test('image kind spawns an ImageElement with empty textureRef + fit=fit', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    const element = createSurfaceElement(scene, ctx, surface, 'image');
    const img = element.getComponent(ImageElement)!;
    expect(img.state.textureRef).toBe('');
    expect(img.state.fit).toBe('fit');
  });

  test('rich kind spawns a RichElement carrying placeholder html', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    const element = createSurfaceElement(scene, ctx, surface, 'rich');
    const rich = element.getComponent(RichElement)!;
    expect(rich).toBeDefined();
    expect(rich.state.html.length).toBeGreaterThan(0);
  });

  test('throws when target entity has no SurfaceComponent', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const naked = new Entity({ id: 'no-surface', type: 't', name: 'no' });
    scene.add(naked);
    expect(() => createSurfaceElement(scene, ctx, naked, 'shape-rect')).toThrow();
  });
});

describe('SurfaceComponent.onEditorTools', () => {
  test('exposes Add Rich UI / Image / Rectangle / Circle buttons', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    const tools = surface.getComponent(SurfaceComponent)!.onEditorTools({
      recipientSeat: null, isHost: true, entity: surface,
    });
    const ids = tools.map(t => (t.kind === 'button' ? t.id : t.label));
    expect(ids).toEqual(['add-rich', 'add-image', 'add-shape-rect', 'add-shape-circle']);
  });
});

describe('attachSticker — element response to mutations', () => {
  test('returned element responds to ShapeElement.setState (parent surface dirty flips)', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { element } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect', fill: '#f00' } },
    });
    surfaceRenderQueue.drain();

    const shape = element.getComponent(ShapeElement)!;
    shape.setState({ fill: '#0f0' });
    expect(surfaceRenderQueue.size()).toBe(1);
  });
});
