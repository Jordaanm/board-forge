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
