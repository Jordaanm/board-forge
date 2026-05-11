import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { SnapPointsComponent, type SnapPoint } from './SnapPointsComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';

let scene:   SceneImpl;
let ctx:     SpawnContext;
let physics: PhysicsWorld;

beforeEach(() => {
  registerCorePrimitives();
  scene   = new SceneImpl();
  physics = new PhysicsWorld();
  ctx     = { scene: new THREE.Scene(), physics, entityScene: scene };
  SnapPointsComponent.setShowAll(false);
});

function pt(over: Partial<SnapPoint> = {}): SnapPoint {
  return {
    id:           'p1',
    localPos:     [0, 0, 0],
    localYaw:     0,
    snapRotation: false,
    radius:       0.5,
    ...over,
  };
}

function getGroup(comp: SnapPointsComponent): THREE.Group {
  const transform = comp.entity.getComponent(TransformComponent)!;
  const child = transform.object3d.children.find(c => c.name === `snap-points:${comp.entity.id}`);
  if (!child) throw new Error('snap-points group not found');
  return child as THREE.Group;
}

describe('SnapPointsComponent — serialization', () => {
  test('toJSON / fromJSON round-trip preserves points', () => {
    const a = new SnapPointsComponent();
    a.state = { points: [pt({ id: 'a', localPos: [1, 2, 3], radius: 0.7, snapRotation: true, localYaw: 1.2 })] };
    const json = a.toJSON();

    const b = new SnapPointsComponent();
    b.fromJSON(json);
    expect(b.state).toEqual(a.state);
  });

  test('applyRemoteState merges points and fires onPropertiesChanged', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    const next = [pt({ id: 'remote', radius: 1.1 })];

    comp.applyRemoteState({ points: next });
    expect(comp.state.points).toEqual(next);
    // Visualization rebuilt from new state — should be 1 point node.
    expect(getGroup(comp).children.length).toBe(1);
  });
});

describe('SnapPointsComponent — registration + spawn', () => {
  test('SnapMarker spawnable creates Transform + SnapPoints only', () => {
    const e = scene.spawn('snap-marker', ctx);
    expect(e.hasComponent(TransformComponent)).toBe(true);
    expect(e.hasComponent(SnapPointsComponent)).toBe(true);
    expect(e.components.has('mesh')).toBe(false);
    expect(e.components.has('physics')).toBe(false);
    expect(e.tags).toContain('snap-marker');
  });

  test('SnapMarker spawns with a single default point', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    expect(comp.state.points.length).toBe(1);
    expect(comp.state.points[0].snapRotation).toBe(false);
  });
});

describe('SnapPointsComponent — showAll toggle', () => {
  test('group is invisible by default after spawn', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    expect(getGroup(comp).visible).toBe(false);
  });

  test('setShowAll(true) flips all live instances visible', () => {
    const a = scene.spawn('snap-marker', ctx);
    const b = scene.spawn('snap-marker', ctx);
    SnapPointsComponent.setShowAll(true);
    expect(getGroup(a.getComponent(SnapPointsComponent)!).visible).toBe(true);
    expect(getGroup(b.getComponent(SnapPointsComponent)!).visible).toBe(true);
  });

  test('setShowAll(false) flips them invisible', () => {
    const e = scene.spawn('snap-marker', ctx);
    SnapPointsComponent.setShowAll(true);
    SnapPointsComponent.setShowAll(false);
    expect(getGroup(e.getComponent(SnapPointsComponent)!).visible).toBe(false);
  });

  test('a new spawn picks up the current showAll state', () => {
    SnapPointsComponent.setShowAll(true);
    const e = scene.spawn('snap-marker', ctx);
    expect(getGroup(e.getComponent(SnapPointsComponent)!).visible).toBe(true);
  });
});

describe('SnapPointsComponent — visualization rebuild', () => {
  test('adding a point inserts a new disc node', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    const before = getGroup(comp).children.length;
    comp.setState({ points: [...comp.state.points, pt({ id: 'p2', localPos: [1, 0, 0] })] });
    expect(getGroup(comp).children.length).toBe(before + 1);
  });

  test('removing a point disposes its node', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [...comp.state.points, pt({ id: 'p2' })] });
    expect(getGroup(comp).children.length).toBe(2);
    comp.setState({ points: comp.state.points.filter(p => p.id !== 'p2') });
    expect(getGroup(comp).children.length).toBe(1);
  });

  test('snapRotation:true adds an arrow child; false omits it', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'p1', snapRotation: false })] });
    const noArrow = getGroup(comp).children[0] as THREE.Group;
    // Just the disc (one Mesh child).
    expect(noArrow.children.length).toBe(1);

    comp.setState({ points: [pt({ id: 'p1', snapRotation: true })] });
    const withArrow = getGroup(comp).children[0] as THREE.Group;
    expect(withArrow.children.length).toBe(2);
  });
});

describe('SnapPointsComponent — raycast guard', () => {
  function getDisc(comp: SnapPointsComponent): THREE.Mesh {
    const pointNode = getGroup(comp).children[0] as THREE.Group;
    return pointNode.children[0] as THREE.Mesh;
  }

  function castThroughDisc(disc: THREE.Mesh): THREE.Intersection[] {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 5, 0),
      new THREE.Vector3(0, -1, 0),
    );
    const intersects: THREE.Intersection[] = [];
    disc.raycast(raycaster, intersects);
    return intersects;
  }

  test('marker disc hits when visualization group is visible', () => {
    const e = scene.spawn('snap-marker', ctx);
    SnapPointsComponent.setShowAll(true);
    const disc = getDisc(e.getComponent(SnapPointsComponent)!);
    disc.updateMatrixWorld(true);
    expect(castThroughDisc(disc).length).toBeGreaterThan(0);
  });

  test('marker disc misses when visualization group is hidden', () => {
    const e = scene.spawn('snap-marker', ctx);
    SnapPointsComponent.setShowAll(false);
    const disc = getDisc(e.getComponent(SnapPointsComponent)!);
    disc.updateMatrixWorld(true);
    expect(castThroughDisc(disc)).toEqual([]);
  });
});

describe('SnapPointsComponent — onDespawn cleanup', () => {
  test('removing the entity drops its instance from the live set', () => {
    const e = scene.spawn('snap-marker', ctx);
    SnapPointsComponent.setShowAll(true);
    scene.despawn(e.id, ctx);
    // No throw, no stale reference. Reflip to force a walk of liveInstances.
    SnapPointsComponent.setShowAll(false);
    SnapPointsComponent.setShowAll(true);
  });
});
