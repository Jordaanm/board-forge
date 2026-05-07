import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { MeshComponent } from './MeshComponent';

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
