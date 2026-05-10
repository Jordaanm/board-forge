import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { Entity } from '../Entity';
import { MeshComponent, type MeshState } from './MeshComponent';
import { TransformComponent } from './TransformComponent';

let scene: SceneImpl;
let ctx: SpawnContext;

beforeEach(() => {
  registerCorePrimitives();
  scene = new SceneImpl();
  ctx = { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };
});

describe('MeshComponent — meshRef branches', () => {
  test('primitive meshRef builds a non-empty group via buildMesh', () => {
    const e = scene.spawn('token', ctx);
    const mesh = e.getComponent(MeshComponent)!;
    expect(mesh.state.meshRef).toBe('prim:meeple');
    expect(mesh.group.children.length).toBeGreaterThan(0);
  });

  test('switching meshRef to a non-prim slug subscribes via AssetService and adds the placeholder', () => {
    const e = scene.spawn('token', ctx);
    const mesh = e.getComponent(MeshComponent)!;
    mesh.setState({ meshRef: 'custom:knight' });
    // Synchronous: the AssetService subscribe fires immediately with the
    // placeholder cube before any network resolution completes.
    expect(mesh.group.children.length).toBe(1);
    const child = mesh.group.children[0];
    expect(child).toBeInstanceOf(THREE.Object3D);
  });

  test('switching back to a prim ref restores the primitive geometry', () => {
    const e = scene.spawn('token', ctx);
    const mesh = e.getComponent(MeshComponent)!;
    mesh.setState({ meshRef: 'custom:knight' });
    mesh.setState({ meshRef: 'prim:cube' });
    expect(mesh.state.meshRef).toBe('prim:cube');
    // prim:cube is a single mesh — verify the group holds it.
    expect(mesh.group.children.length).toBe(1);
  });
});

describe('MeshComponent — prim:plane', () => {
  function spawnPlane(state: Partial<MeshState> = {}): { entity: Entity; mesh: MeshComponent } {
    const entity = new Entity({ id: 'p-1', type: 'plane', name: 'Plane' });
    const transform = new TransformComponent();
    transform.fromJSON({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    entity.attachComponent(transform);
    const mesh = new MeshComponent();
    mesh.fromJSON({
      meshRef:     'prim:plane',
      textureRefs: { default: '' },
      color:        '#ffffff',
      size:        [2, 0.01, 3],
      ...state,
    });
    entity.attachComponent(mesh);
    transform.onSpawn(ctx);
    mesh.onSpawn(ctx);
    return { entity, mesh };
  }

  test('builds a single-mesh group with PlaneGeometry sized from size[0] × size[2]', () => {
    const { mesh } = spawnPlane();
    expect(mesh.group.children.length).toBe(1);
    const child = mesh.group.children[0] as THREE.Mesh;
    expect(child).toBeInstanceOf(THREE.Mesh);
    expect(child.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    const params = (child.geometry as THREE.PlaneGeometry).parameters;
    expect(params.width).toBe(2);
    expect(params.height).toBe(3);
  });

  test('halfExtents returns [w/2, d/2, 0]; size[1] (height) is ignored', () => {
    const { mesh } = spawnPlane({ size: [4, 99, 6] });
    expect(mesh.halfExtents()).toEqual([2, 3, 0]);
  });

  test('default PlaneGeometry UVs paired with flipY=true CanvasTexture put canvas top-left at visual top when viewed from +Z', () => {
    const { mesh } = spawnPlane();
    const child = mesh.group.children[0] as THREE.Mesh;
    const uv = (child.geometry as THREE.PlaneGeometry).attributes.uv as THREE.BufferAttribute;
    // PlaneGeometry default vertex order: top-left, top-right, bottom-left,
    // bottom-right where +Y is up. Default UVs put V=1 at top-left; with
    // flipY=true (CanvasTexture default) V=1 samples canvas y=0, so canvas
    // top-left lands at the plane's top-left vertex.
    expect(uv.getX(0)).toBe(0);
    expect(uv.getY(0)).toBe(1);
  });

  test('round-trip: toJSON → fromJSON identity', () => {
    const { mesh } = spawnPlane({ color: '#abcdef', textureRefs: { default: 'base:tex/foo' } });
    const json = mesh.toJSON();

    const fresh = new MeshComponent();
    fresh.fromJSON(json);
    expect(fresh.toJSON()).toEqual(json);
  });

  test('tint change applies via onPropertiesChanged', () => {
    const { mesh } = spawnPlane();
    mesh.setState({ color: '#ff0000' });
    const child = mesh.group.children[0] as THREE.Mesh;
    const mat   = child.material as THREE.MeshLambertMaterial;
    expect(mat.color.getHexString()).toBe('ff0000');
  });

  test('textureRefs.default routes through applyMaterialAttributes (placeholder texture installed)', () => {
    const { mesh } = spawnPlane({ textureRefs: { default: 'base:tex/foo' } });
    const child = mesh.group.children[0] as THREE.Mesh;
    const mat   = child.material as THREE.MeshLambertMaterial;
    // AssetService subscribe fires synchronously with a placeholder texture.
    expect(mat.map).not.toBeNull();
  });

  test('despawn cleans up children and texture subscriptions', () => {
    const { mesh } = spawnPlane({ textureRefs: { default: 'base:tex/foo' } });
    mesh.onDespawn(ctx);
    // Group is detached from any parent it had been added to.
    expect(mesh.group.parent).toBeNull();
  });
});

describe('MeshComponent — isContained visibility', () => {
  test('group.visible is true on spawn when entity is not contained', () => {
    const e = scene.spawn('card', ctx);
    const mesh = e.getComponent(MeshComponent)!;
    expect(mesh.group.visible).toBe(true);
  });

  test('group.visible is false on spawn when entity is contained', () => {
    const e = scene.spawn('card', ctx);
    e.isContained = true;
    // Re-fire visibility — simulates a load that started with isContained=true.
    e.getComponent(MeshComponent)!.onIsContainedChanged(true);
    expect(e.getComponent(MeshComponent)!.group.visible).toBe(false);
  });

  test('onIsContainedChanged toggles group.visible', () => {
    const e = scene.spawn('card', ctx);
    const mesh = e.getComponent(MeshComponent)!;
    expect(mesh.group.visible).toBe(true);

    mesh.onIsContainedChanged(true);
    expect(mesh.group.visible).toBe(false);

    mesh.onIsContainedChanged(false);
    expect(mesh.group.visible).toBe(true);
  });
});

describe('MeshComponent — propertySchema (issue #2 of property-schema-refactor)', () => {
  test('declares static label and color/meshRef/textureUrl entries', () => {
    expect(MeshComponent.label).toBe('Mesh');
    const keys = MeshComponent.propertySchema.map(d => d.key);
    expect(keys).toEqual(['color', 'meshRef', 'textureUrl']);
  });

  test('textureUrl adapter get returns the default ref', () => {
    const def = MeshComponent.propertySchema.find(d => d.key === 'textureUrl')!;
    const state: MeshState = {
      meshRef: 'prim:cube',
      textureRefs: { default: 'base:tex/foo', face: 'unrelated' },
      color: '#fff',
      size: 1,
    };
    expect(def.get!(state, undefined as never)).toBe('base:tex/foo');
  });

  test('textureUrl adapter get returns empty string when missing', () => {
    const def = MeshComponent.propertySchema.find(d => d.key === 'textureUrl')!;
    const state: MeshState = {
      meshRef: 'prim:cube',
      textureRefs: {},
      color: '#fff',
      size: 1,
    };
    expect(def.get!(state, undefined as never)).toBe('');
  });

  test('textureUrl adapter set merges into the textureRefs map preserving siblings', () => {
    const def = MeshComponent.propertySchema.find(d => d.key === 'textureUrl')!;
    const state: MeshState = {
      meshRef: 'prim:card',
      textureRefs: { default: 'old', face: 'F.png', back: 'B.png' },
      color: '#fff',
      size: 1,
    };
    const patch = def.set!('new.png', state, undefined as never);
    expect(patch).toEqual({
      textureRefs: { default: 'new.png', face: 'F.png', back: 'B.png' },
    });
  });
});
