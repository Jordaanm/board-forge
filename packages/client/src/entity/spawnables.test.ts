import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Scene, entityToSerialized, type EntitySerialized } from './Scene';
import { type SpawnContext } from './EntityComponent';
import { TransformComponent } from './components/TransformComponent';
import { MeshComponent } from './components/MeshComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { ValueComponent } from './components/ValueComponent';
import { registerCorePrimitives } from './spawnables';
import { PhysicsWorld } from '../physics/PhysicsWorld';

let ctx: SpawnContext;

beforeEach(() => {
  Scene.clear();
  registerCorePrimitives();
  ctx = { scene: new THREE.Scene(), physics: new PhysicsWorld() };
});

describe('spawnables — board / die / token spawn', () => {
  test('die spawns with transform/mesh/physics/value components', () => {
    const e = Scene.spawn('die', ctx);
    expect(e.type).toBe('die');
    expect(e.tags).toEqual(['die']);
    expect(e.getComponent(TransformComponent)).toBeDefined();
    expect(e.getComponent(MeshComponent)).toBeDefined();
    expect(e.getComponent(PhysicsComponent)).toBeDefined();
    expect(e.getComponent(ValueComponent)).toBeDefined();
  });

  test('board spawns with transform/mesh/physics; no value', () => {
    const e = Scene.spawn('board', ctx);
    expect(e.type).toBe('board');
    expect(e.tags).toEqual(['board']);
    expect(e.getComponent(ValueComponent)).toBeUndefined();
    expect(e.getComponent(MeshComponent)!.state.size).toEqual([4, 0.05, 3]);
  });

  test('token spawns with meeple primitive + blue tint', () => {
    const e = Scene.spawn('token', ctx);
    expect(e.getComponent(MeshComponent)!.state.meshRef).toBe('prim:meeple');
    expect(e.getComponent(MeshComponent)!.state.tint).toBe('#2266cc');
  });

  test('default name format `${label}-${guid.slice(0,8)}`', () => {
    const e = Scene.spawn('die', ctx);
    expect(e.name).toMatch(/^Die \(D6\)-[0-9a-f]{8}$/);
  });

  test('onSpawn builds the THREE Object3D and CANNON Body', () => {
    const e = Scene.spawn('die', ctx);
    const t = e.getComponent(TransformComponent)!;
    const p = e.getComponent(PhysicsComponent)!;
    expect(t.object3d).toBeInstanceOf(THREE.Object3D);
    expect(t.object3d.parent).toBe(ctx.scene);
    expect(p.body).toBeDefined();
    expect(ctx.physics!.world.bodies).toContain(p.body);
  });

  test('explicit id round-trips through spawn', () => {
    const e = Scene.spawn('die', ctx, { id: 'fixed-id' });
    expect(e.id).toBe('fixed-id');
    expect(Scene.getEntity('fixed-id')).toBe(e);
  });
});

describe('spawnables — replicate (state mutation)', () => {
  test('Transform.setState merges + updates Object3D pose', () => {
    const e = Scene.spawn('die', ctx);
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: [5, 6, 7], rotation: t.state.rotation, scale: t.state.scale });
    expect(t.state.position).toEqual([5, 6, 7]);
    expect(t.object3d.position.x).toBe(5);
    expect(t.object3d.position.y).toBe(6);
    expect(t.object3d.position.z).toBe(7);
  });

  test('Mesh.setState rebuilds the geometry on meshRef/size change', () => {
    const e = Scene.spawn('board', ctx);
    const m = e.getComponent(MeshComponent)!;
    const before = m.group.children[0];
    m.setState({ size: [6, 0.05, 4] });
    const after = m.group.children[0];
    expect(after).not.toBe(before);  // rebuilt
  });

  test('Physics state changes propagate to the CANNON body', () => {
    const e = Scene.spawn('die', ctx);
    const p = e.getComponent(PhysicsComponent)!;
    p.setState({ mass: 2 });
    expect(p.body.mass).toBe(2);
  });

  test('Value.setState merges value + isNumeric', () => {
    const e = Scene.spawn('die', ctx);
    const v = e.getComponent(ValueComponent)!;
    v.setState({ value: '3', isNumeric: true });
    expect(v.state.value).toBe('3');
    expect(v.asNumber()).toBe(3);
  });
});

describe('spawnables — despawn tears down view artefacts', () => {
  test('despawning a die removes Object3D from scene + body from physics', () => {
    const e = Scene.spawn('die', ctx);
    const t = e.getComponent(TransformComponent)!;
    const p = e.getComponent(PhysicsComponent)!;
    expect(t.object3d.parent).toBe(ctx.scene);
    Scene.despawn(e.id, ctx);
    expect(t.object3d.parent).toBeNull();
    expect(ctx.physics!.world.bodies).not.toContain(p.body);
    expect(Scene.getEntity(e.id)).toBeUndefined();
  });

  test('despawn returns the cascade-deleted ids in order', () => {
    const e = Scene.spawn('die', ctx);
    const removed = Scene.despawn(e.id, ctx);
    expect(removed).toEqual([e.id]);
  });
});

describe('spawnables — serialised snapshot shape', () => {
  test('die EntitySerialized matches expected shape', () => {
    const e = Scene.spawn('die', ctx, { id: 'die-1' });
    const snap: EntitySerialized = entityToSerialized(e);
    expect(snap.id).toBe('die-1');
    expect(snap.type).toBe('die');
    expect(snap.tags).toEqual(['die']);
    expect(snap.owner).toBeNull();
    expect(snap.privateToSeat).toBeNull();
    expect(snap.parentId).toBeNull();
    expect(snap.children).toEqual([]);
    expect(Object.keys(snap.components).sort()).toEqual(['mesh', 'physics', 'transform', 'value']);
    expect(snap.components.value).toEqual({ value: '6', isNumeric: true });
    expect(snap.components.physics).toEqual({ mass: 0.2, friction: 0.5, restitution: 0.5 });
    expect(snap.components.mesh).toMatchObject({ meshRef: 'prim:cube', size: 0.7 });
  });

  test('snapshot round-trips JSON without loss', () => {
    const e = Scene.spawn('token', ctx, { id: 'tok-1' });
    const original = entityToSerialized(e);
    const cloned: EntitySerialized = JSON.parse(JSON.stringify(original));
    expect(cloned).toEqual(original);
  });
});
