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
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { elementBitmapCache } from './ElementBitmapCache';
import { attachSticker, createSurfaceChild, appendDefaultElement } from './attachSticker';

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
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

describe('attachSticker — return shape (issue #2 of refactor)', () => {
  test('returns { surfaceEntity, elementHandle } and appends one element to the surface', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);

    const { surfaceEntity, elementHandle } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect', fill: '#f00' } },
    });

    expect(surfaceEntity.parentId).toBe(parent.id);
    expect(parent.children).toContain(surfaceEntity.id);
    const surface = surfaceEntity.getComponent(SurfaceComponent)!;
    expect(surface.state.elements).toHaveLength(1);
    expect(surface.state.elements[0].kind).toBe('shape');

    expect(elementHandle.surfaceId).toBe(surfaceEntity.id);
    expect(elementHandle.elementId).toBe(surface.state.elements[0].id);
  });

  test('html content produces a kind-rich element with the supplied html', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { html: '<div>hi</div>' },
    });
    const surface = surfaceEntity.getComponent(SurfaceComponent)!;
    const el = surface.state.elements[0];
    expect(el.kind).toBe('rich');
    if (el.kind === 'rich') expect(el.html).toBe('<div>hi</div>');
  });

  test('image content produces a kind-image element with textureRef + fit', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'front',
      content: { image: 'base:tex/portrait', fit: 'cover' },
    });
    const surface = surfaceEntity.getComponent(SurfaceComponent)!;
    const el = surface.state.elements[0];
    expect(el.kind).toBe('image');
    if (el.kind === 'image') {
      expect(el.textureRef).toBe('base:tex/portrait');
      expect(el.fit).toBe('cover');
    }
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
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'top',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const t = surfaceEntity.getComponent(TransformComponent)!;
    expect(t.state.position[1]).toBeCloseTo(0.5, 5);
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...t.state.rotation));
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(1, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  test('front: identity rotation, position at +hz', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [1, 0.5, 1.5]);
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'front',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const t = surfaceEntity.getComponent(TransformComponent)!;
    expect(t.state.position[2]).toBeCloseTo(1.5, 5);
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...t.state.rotation));
    expect(v.z).toBeCloseTo(1, 5);
  });

  test('right: position at +hx, +Z rotates to +X', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx, [2, 0.5, 1]);
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'right',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const t = surfaceEntity.getComponent(TransformComponent)!;
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
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect' } },
    });
    const y = surfaceEntity.getComponent(TransformComponent)!.state.position[1];
    expect(y).toBeGreaterThan(0.5);
    expect(y - 0.5).toBeLessThan(0.01);
  });
});

describe('createSurfaceChild', () => {
  test('creates a surface entity (transform + plane mesh + surface) parented to the parent, no elements', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);

    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });

    expect(surface.parentId).toBe(parent.id);
    expect(parent.children).toContain(surface.id);
    expect(surface.getComponent(TransformComponent)).toBeDefined();
    expect(surface.getComponent(MeshComponent)!.state.meshRef).toBe('prim:plane');
    expect(surface.getComponent(SurfaceComponent)).toBeDefined();
    expect(surface.getComponent(SurfaceComponent)!.state.elements).toEqual([]);
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

describe('appendDefaultElement', () => {
  test('shape-rect appends a kind-shape element with shape=rect, sized to canvas', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top', canvasSize: [256, 128] });

    const elementId = appendDefaultElement(surface, 'shape-rect');

    const surfaceComp = surface.getComponent(SurfaceComponent)!;
    expect(surfaceComp.state.elements).toHaveLength(1);
    const el = surfaceComp.state.elements[0];
    expect(el.id).toBe(elementId);
    expect(el.kind).toBe('shape');
    if (el.kind === 'shape') expect(el.shape).toBe('rect');
    expect(el.w).toBe(256);
    expect(el.h).toBe(128);
  });

  test('shape-circle appends a kind-shape element with shape=circle', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    appendDefaultElement(surface, 'shape-circle');
    const el = surface.getComponent(SurfaceComponent)!.state.elements[0];
    expect(el.kind).toBe('shape');
    if (el.kind === 'shape') expect(el.shape).toBe('circle');
  });

  test('image appends a kind-image element with empty textureRef + fit=fit', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    appendDefaultElement(surface, 'image');
    const el = surface.getComponent(SurfaceComponent)!.state.elements[0];
    expect(el.kind).toBe('image');
    if (el.kind === 'image') {
      expect(el.textureRef).toBe('');
      expect(el.fit).toBe('fit');
    }
  });

  test('rich appends a kind-rich element carrying placeholder html', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const surface = createSurfaceChild(scene, ctx, parent, { face: 'top' });
    appendDefaultElement(surface, 'rich');
    const el = surface.getComponent(SurfaceComponent)!.state.elements[0];
    expect(el.kind).toBe('rich');
    if (el.kind === 'rich') expect(el.html.length).toBeGreaterThan(0);
  });

  test('throws when target entity has no SurfaceComponent', () => {
    const scene = new SceneImpl();
    const naked = new Entity({ id: 'no-surface', type: 't', name: 'no' });
    scene.add(naked);
    expect(() => appendDefaultElement(naked, 'shape-rect')).toThrow();
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

describe('attachSticker — parent pose composition (issue #1 of refactor)', () => {
  function makeParentAt(
    scene: SceneImpl,
    ctx: SpawnContext,
    position: [number, number, number],
    rotation: [number, number, number, number],
    halfExtents: [number, number, number] = [1, 0.5, 1.5],
  ): Entity {
    const parent = new Entity({ id: 'parent-1', type: 'token', name: 'Token' });
    const transform = new TransformComponent();
    transform.fromJSON({ position, rotation, scale: [1, 1, 1] });
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

  test('non-origin / non-identity parent: sticker world = parent.world * sticker.local', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parentPos: [number, number, number] = [3, 5, -2];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    const parentRot: [number, number, number, number] = [q.x, q.y, q.z, q.w];
    const parent = makeParentAt(scene, ctx, parentPos, parentRot);

    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'top',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });

    const t = surfaceEntity.getComponent(TransformComponent)!;
    t.object3d.updateWorldMatrix(true, false);

    const expected = new THREE.Matrix4()
      .compose(
        new THREE.Vector3(...parentPos),
        new THREE.Quaternion(...parentRot),
        new THREE.Vector3(1, 1, 1),
      )
      .multiply(new THREE.Matrix4().compose(
        new THREE.Vector3(...t.state.position),
        new THREE.Quaternion(...t.state.rotation),
        new THREE.Vector3(1, 1, 1),
      ));
    const expPos = new THREE.Vector3();
    const expQuat = new THREE.Quaternion();
    const expScale = new THREE.Vector3();
    expected.decompose(expPos, expQuat, expScale);

    const actualPos = new THREE.Vector3();
    const actualQuat = new THREE.Quaternion();
    t.object3d.getWorldPosition(actualPos);
    t.object3d.getWorldQuaternion(actualQuat);

    expect(actualPos.x).toBeCloseTo(expPos.x, 5);
    expect(actualPos.y).toBeCloseTo(expPos.y, 5);
    expect(actualPos.z).toBeCloseTo(expPos.z, 5);
    expect(Math.abs(actualQuat.dot(expQuat))).toBeCloseTo(1, 5);
  });

  test('parent moves after spawn: sticker follows without setState on the surface transform', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParentAt(scene, ctx, [0, 0, 0], [0, 0, 0, 1]);
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'top',
      offset:  0,
      content: { shape: { kind: 'rect' } },
    });
    const surfaceT = surfaceEntity.getComponent(TransformComponent)!;
    const stickerLocal: [number, number, number] = [...surfaceT.state.position];

    const parentT = parent.getComponent(TransformComponent)!;
    parentT.object3d.position.set(10, 2, -3);
    parentT.object3d.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    surfaceT.object3d.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(10 + stickerLocal[0], 5);
    expect(worldPos.y).toBeCloseTo(2  + stickerLocal[1], 5);
    expect(worldPos.z).toBeCloseTo(-3 + stickerLocal[2], 5);
    expect(surfaceT.state.position).toEqual(stickerLocal);
  });

  test('SurfaceComponent.onDespawn detaches the surface object3d from the parent', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParentAt(scene, ctx, [0, 0, 0], [0, 0, 0, 1]);
    const { surfaceEntity } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect' } },
    });
    const parentObj  = parent       .getComponent(TransformComponent)!.object3d;
    const surfaceObj = surfaceEntity.getComponent(TransformComponent)!.object3d;
    expect(parentObj.children).toContain(surfaceObj);

    surfaceEntity.getComponent(SurfaceComponent)!.onDespawn(ctx);
    expect(parentObj.children).not.toContain(surfaceObj);
  });
});

describe('attachSticker — element handle round-trips through SurfaceComponent state', () => {
  test('elementHandle.setBounds mutates the underlying element entry and flips dirty', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { surfaceEntity, elementHandle } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect', fill: '#f00' } },
    });
    const surface = surfaceEntity.getComponent(SurfaceComponent)!;
    surfaceRenderQueue.drain();

    elementHandle.setBounds(10, 20, 30, 40);

    expect(surfaceRenderQueue.size()).toBe(1);
    const el = surface.state.elements[0];
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.w).toBe(30);
    expect(el.h).toBe(40);
  });

  test('elementHandle.addEventListener fires when the surface dispatches to the element id', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { surfaceEntity, elementHandle } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect' } },
    });
    let received: unknown = null;
    elementHandle.addEventListener('click', (p) => { received = p; });

    const surface = surfaceEntity.getComponent(SurfaceComponent)!;
    // Dispatch a click via UV → pixel; default sticker covers full canvas.
    surface.onClick({ seat: 0, shiftKey: false, ctrlKey: false, altKey: false, surfaceUV: { u: 0.5, v: 0.5 } });
    expect(received).not.toBeNull();
  });

  test('elementHandle.setHtml on a shape-kind element warns and no-ops', () => {
    const scene = new SceneImpl();
    const ctx = makeCtx(scene);
    const parent = makeParent(scene, ctx);
    const { surfaceEntity, elementHandle } = attachSticker(scene, ctx, parent, {
      face:    'top',
      content: { shape: { kind: 'rect', fill: '#f00' } },
    });
    const surface = surfaceEntity.getComponent(SurfaceComponent)!;
    elementHandle.setHtml('<i>nope</i>');
    const el = surface.state.elements[0];
    expect(el.kind).toBe('shape');
  });
});
