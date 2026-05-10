import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SceneImpl, type EntitySerialized } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { type Entity } from '../Entity';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { ZoneComponent } from './ZoneComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { HoldService } from '../HoldService';
import { HostReplicatorV2, type ReplicatorPolicy } from '../HostReplicatorV2';

const POLICY: ReplicatorPolicy = {
  channelFor:  () => 'reliable',
  coalesceFor: () => 'merge',
  shouldFlush: () => true,
};

let scene:   SceneImpl;
let ctx:     SpawnContext;
let physics: PhysicsWorld;

beforeEach(() => {
  registerCorePrimitives();
  scene   = new SceneImpl();
  physics = new PhysicsWorld();
  ctx     = { scene: new THREE.Scene(), physics, entityScene: scene };
  ZoneComponent.showAllZones     = false;
  ZoneComponent.selectedEntityId = null;
});

function placeAt(entity: Entity, x: number, y: number, z: number): void {
  const t = entity.getComponent(TransformComponent)!;
  t.setState({ position: [x, y, z], rotation: t.state.rotation, scale: t.state.scale });
  const phys = entity.getComponent(PhysicsComponent);
  if (phys) phys.body.position.set(x, y, z);
  entity.getComponent(ZoneComponent)?.syncBodyFromTransform();
}

function fireBeginContact(world: CANNON.World, bodyA: CANNON.Body, bodyB: CANNON.Body): void {
  world.dispatchEvent({ type: 'beginContact', bodyA, bodyB });
}

function fireEndContact(world: CANNON.World, bodyA: CANNON.Body, bodyB: CANNON.Body): void {
  world.dispatchEvent({ type: 'endContact', bodyA, bodyB });
}

describe('ZoneComponent — sensor body lifecycle', () => {
  test('onSpawn registers a kinematic sensor body in the physics world', () => {
    const before = physics.world.bodies.length;
    const e = scene.spawn('zone', ctx);
    const zone = e.getComponent(ZoneComponent)!;

    expect(physics.world.bodies).toContain(zone.body);
    expect(physics.world.bodies.length).toBe(before + 1);
    expect(zone.body.type).toBe(CANNON.Body.KINEMATIC);
    expect(zone.body.mass).toBe(0);
    expect(zone.body.collisionResponse).toBe(false);
    expect(zone.body.isTrigger).toBe(true);
  });

  test('onDespawn removes the sensor body from the physics world', () => {
    const e = scene.spawn('zone', ctx);
    const body = e.getComponent(ZoneComponent)!.body;
    expect(physics.world.bodies).toContain(body);

    scene.despawn(e.id, ctx);
    expect(physics.world.bodies).not.toContain(body);
  });

  test('halfExtents update rebuilds the body shape', () => {
    const e = scene.spawn('zone', ctx);
    const zone = e.getComponent(ZoneComponent)!;

    zone.setState({ halfExtents: [2, 0.5, 1] });
    const shape = zone.body.shapes[0] as CANNON.Box;
    expect(shape.halfExtents.x).toBe(2);
    expect(shape.halfExtents.y).toBe(0.5);
    expect(shape.halfExtents.z).toBe(1);
  });

  test('syncBodyFromTransform copies transform pose into the body', () => {
    const e = scene.spawn('zone', ctx);
    const zone = e.getComponent(ZoneComponent)!;
    placeAt(e, 1, 2, 3);
    expect(zone.body.position.x).toBe(1);
    expect(zone.body.position.y).toBe(2);
    expect(zone.body.position.z).toBe(3);
  });
});

describe('ZoneComponent — enter / exit membership', () => {
  test('beginContact with a passing entity adds it to containedIds and fires enter', () => {
    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;

    const entered: Entity[] = [];
    zone.subscribeEnter(e => entered.push(e));

    fireBeginContact(physics.world, zone.body, d.getComponent(PhysicsComponent)!.body);

    expect(zone.state.containedIds).toEqual([d.id]);
    expect(entered).toEqual([d]);
  });

  test('endContact removes from containedIds and fires exit', () => {
    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;
    const dieBody = d.getComponent(PhysicsComponent)!.body;

    fireBeginContact(physics.world, zone.body, dieBody);

    const exited: Entity[] = [];
    zone.subscribeExit(e => exited.push(e));

    fireEndContact(physics.world, zone.body, dieBody);

    expect(zone.state.containedIds).toEqual([]);
    expect(exited).toEqual([d]);
  });

  test('contact events that do not reference the zone body are ignored', () => {
    const z = scene.spawn('zone', ctx);
    const a = scene.spawn('die',  ctx);
    const b = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;

    fireBeginContact(physics.world,
      a.getComponent(PhysicsComponent)!.body,
      b.getComponent(PhysicsComponent)!.body,
    );

    expect(zone.state.containedIds).toEqual([]);
  });
});

describe('ZoneComponent — filter', () => {
  function snapZone(state: Partial<ZoneComponent['state']>): EntitySerialized {
    return {
      id: 'zone-1',
      type: 'zone',
      name: 'Zone-zone-1',
      tags: ['zone'],
      owner: null,
      privateToSeat: null,
      parentId: null,
      children: [],
      components: {
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        zone: {
          halfExtents:  [0.5, 0.5, 0.5],
          containedIds: [],
          isVisible:    false,
          ...state,
        },
      },
    };
  }

  test('acceptComponents filter excludes entities lacking the component', () => {
    const [z] = scene.load([snapZone({ acceptComponents: ['flatview'] })], ctx);
    const d = scene.spawn('die', ctx);  // no flatview
    const zone = z.getComponent(ZoneComponent)!;

    fireBeginContact(physics.world, zone.body, d.getComponent(PhysicsComponent)!.body);

    expect(zone.state.containedIds).toEqual([]);
    expect(zone.getOverlappingEntities()).toEqual([d]);  // raw overlap still tracks it
  });

  test('acceptComponents filter admits entities that have the component', () => {
    const [z] = scene.load([snapZone({ acceptComponents: ['flatview'] })], ctx);
    const c = scene.spawn('card', ctx);  // has flatview
    const zone = z.getComponent(ZoneComponent)!;

    fireBeginContact(physics.world, zone.body, c.getComponent(PhysicsComponent)!.body);

    expect(zone.state.containedIds).toEqual([c.id]);
  });

  test('acceptTags filter requires the entity to carry one of the listed tags', () => {
    const [z] = scene.load([snapZone({ acceptTags: ['card'] })], ctx);
    const d = scene.spawn('die',  ctx);
    const c = scene.spawn('card', ctx);
    const zone = z.getComponent(ZoneComponent)!;

    fireBeginContact(physics.world, zone.body, d.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, zone.body, c.getComponent(PhysicsComponent)!.body);

    expect(zone.state.containedIds).toEqual([c.id]);
  });

  test('held entities (heldBy != null) are excluded from membership', () => {
    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;

    d.heldBy = 0;
    fireBeginContact(physics.world, zone.body, d.getComponent(PhysicsComponent)!.body);

    expect(zone.state.containedIds).toEqual([]);
    // Raw overlap still records the body — only filter excludes it.
    expect(zone.getOverlappingEntities()).toEqual([d]);
  });
});

describe('ZoneComponent — hold-release re-evaluation', () => {
  test('HoldService.release recomputes membership; previously-held entity joins', () => {
    scene.world = new HostReplicatorV2(POLICY);
    const hold = new HoldService(scene.world as HostReplicatorV2, scene);

    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;
    const dieBody = d.getComponent(PhysicsComponent)!.body;

    // Carry the die into the zone — held filter excludes it from containedIds.
    hold.tryClaim(d, 0);
    fireBeginContact(physics.world, zone.body, dieBody);
    expect(zone.state.containedIds).toEqual([]);

    // Release; HoldService loops zones and recomputes.
    hold.release(d);
    expect(zone.state.containedIds).toEqual([d.id]);
  });

  test('recomputeMembership drops entities whose AABB no longer overlaps', () => {
    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;
    const dieBody = d.getComponent(PhysicsComponent)!.body;

    fireBeginContact(physics.world, zone.body, dieBody);
    fireEndContact  (physics.world, zone.body, dieBody);

    zone.recomputeMembership();
    expect(zone.state.containedIds).toEqual([]);
  });
});

describe('ZoneComponent — guest-side diff', () => {
  test('applyRemoteState mutating containedIds fires enter/exit handlers', () => {
    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;

    const entered: string[] = [];
    const exited:  string[] = [];
    zone.subscribeEnter(e => entered.push(e.id));
    zone.subscribeExit (e => exited.push(e.id));

    zone.applyRemoteState({ containedIds: [d.id] });
    expect(entered).toEqual([d.id]);
    expect(exited).toEqual([]);

    zone.applyRemoteState({ containedIds: [] });
    expect(exited).toEqual([d.id]);
  });
});

describe('ZoneComponent — debug visual', () => {
  test('mesh is invisible by default (isVisible false, nothing selected, toggle off)', () => {
    const z = scene.spawn('zone', ctx);
    z.getComponent(ZoneComponent)!.setState({ isVisible: false });
    z.getComponent(ZoneComponent)!.updateDebugVisibility();
    expect(getDebugMesh(z).visible).toBe(false);
  });

  test('isVisible=true forces the mesh visible', () => {
    const z = scene.spawn('zone', ctx);
    z.getComponent(ZoneComponent)!.setState({ isVisible: true });
    expect(getDebugMesh(z).visible).toBe(true);
  });

  test('selecting the zone in the editor makes it visible', () => {
    const z = scene.spawn('zone', ctx);
    z.getComponent(ZoneComponent)!.setState({ isVisible: false });

    ZoneComponent.selectedEntityId = z.id;
    z.getComponent(ZoneComponent)!.updateDebugVisibility();
    expect(getDebugMesh(z).visible).toBe(true);

    ZoneComponent.selectedEntityId = 'something-else';
    z.getComponent(ZoneComponent)!.updateDebugVisibility();
    expect(getDebugMesh(z).visible).toBe(false);
  });

  test('global Show All Zones toggle makes every zone visible', () => {
    const a = scene.spawn('zone', ctx);
    const b = scene.spawn('zone', ctx);
    a.getComponent(ZoneComponent)!.setState({ isVisible: false });
    b.getComponent(ZoneComponent)!.setState({ isVisible: false });

    ZoneComponent.showAllZones = true;
    a.getComponent(ZoneComponent)!.updateDebugVisibility();
    b.getComponent(ZoneComponent)!.updateDebugVisibility();
    expect(getDebugMesh(a).visible).toBe(true);
    expect(getDebugMesh(b).visible).toBe(true);
  });
});

describe('ZoneComponent — orthogonal to scene-graph parent/child', () => {
  test('entering a zone does not mutate parentId', () => {
    const z = scene.spawn('zone', ctx);
    const d = scene.spawn('die',  ctx);
    const zone = z.getComponent(ZoneComponent)!;

    expect(d.parentId).toBeNull();
    fireBeginContact(physics.world, zone.body, d.getComponent(PhysicsComponent)!.body);
    expect(d.parentId).toBeNull();
  });
});

function getDebugMesh(entity: Entity): THREE.Mesh {
  const t = entity.getComponent(TransformComponent)!;
  const mesh = t.object3d.children.find(c => c instanceof THREE.Mesh);
  if (!mesh) throw new Error('zone debug mesh not found');
  return mesh as THREE.Mesh;
}

describe('ZoneComponent — propertySchema (issue #5 of property-schema-refactor)', () => {
  function makeState(extents: [number, number, number]): import('./ZoneComponent').ZoneState {
    return { halfExtents: extents, containedIds: [], isVisible: false };
  }

  test('declares static label and the four expected entries', () => {
    expect(ZoneComponent.label).toBe('Zone');
    const keys = ZoneComponent.propertySchema.map(d => d.key);
    expect(keys).toEqual(['halfExtentsX', 'halfExtentsY', 'halfExtentsZ', 'isVisible']);
  });

  test('halfExtentsX adapter isolates the X axis on read and merges on write', () => {
    const def = ZoneComponent.propertySchema.find(d => d.key === 'halfExtentsX')!;
    const state = makeState([1, 2, 3]);
    expect(def.get!(state, undefined as never)).toBe(1);
    const patch = def.set!(7, state, undefined as never);
    expect(patch).toEqual({ halfExtents: [7, 2, 3] });
  });

  test('halfExtentsY adapter isolates the Y axis on read and merges on write', () => {
    const def = ZoneComponent.propertySchema.find(d => d.key === 'halfExtentsY')!;
    const state = makeState([1, 2, 3]);
    expect(def.get!(state, undefined as never)).toBe(2);
    const patch = def.set!(7, state, undefined as never);
    expect(patch).toEqual({ halfExtents: [1, 7, 3] });
  });

  test('halfExtentsZ adapter isolates the Z axis on read and merges on write', () => {
    const def = ZoneComponent.propertySchema.find(d => d.key === 'halfExtentsZ')!;
    const state = makeState([1, 2, 3]);
    expect(def.get!(state, undefined as never)).toBe(3);
    const patch = def.set!(7, state, undefined as never);
    expect(patch).toEqual({ halfExtents: [1, 2, 7] });
  });
});
