import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { SnapPointsComponent, type SnapPoint } from './SnapPointsComponent';
import { type EditorToolItem } from '../editorTools';
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
    snapY:        false,
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

describe('SnapPointsComponent — editor numeric form', () => {
  test('onEditorTools returns heading + two rows per point + add button (host)', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [
      pt({ id: 'a', localPos: [1, 2, 3], localYaw: 0.5, radius: 0.7, snapRotation: true }),
      pt({ id: 'b' }),
    ] });
    const items = comp.onEditorTools({ recipientSeat: null, isHost: true, entity: e });
    expect(items[0]).toEqual({ kind: 'heading', label: 'Snap Points' });
    // Two points → four rows (pose + config per point), then the Add button.
    expect(items.slice(1, 5).map(i => i.kind)).toEqual(['row', 'row', 'row', 'row']);
    expect(items[items.length - 1]).toEqual({ kind: 'button', id: 'add-point', label: 'Add Snap Point' });
  });

  test('row 1 is pose (x/y/z/yaw); row 2 is radius/snap-yaw/snap-y/delete', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a' })] });
    const items = comp.onEditorTools({ recipientSeat: null, isHost: true, entity: e });
    const pose   = items[1] as Extract<EditorToolItem, { kind: 'row' }>;
    const config = items[2] as Extract<EditorToolItem, { kind: 'row' }>;
    expect(pose.items.map(i => (i as { id?: string }).id))
      .toEqual(['edit-x', 'edit-y', 'edit-z', 'edit-yaw']);
    expect(config.items.map(i => (i as { id?: string }).id))
      .toEqual(['edit-radius', 'edit-rot', 'edit-snap-y', 'delete-point']);
  });

  test('onEditorTools returns empty on non-host', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    expect(comp.onEditorTools({ recipientSeat: null, isHost: false, entity: e })).toEqual([]);
  });

  test("rows carry per-point pointId in every interactive item's args", () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'pid-1' })] });
    const items = comp.onEditorTools({ recipientSeat: null, isHost: true, entity: e });
    const pose   = items[1] as Extract<EditorToolItem, { kind: 'row' }>;
    const config = items[2] as Extract<EditorToolItem, { kind: 'row' }>;
    for (const sub of [...pose.items, ...config.items]) {
      if (sub.kind === 'number' || sub.kind === 'boolean' || sub.kind === 'button') {
        expect((sub.args as { pointId: string }).pointId).toBe('pid-1');
      }
    }
  });

  test('add-point action appends a fresh point with default radius', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    const before = comp.state.points.length;
    comp.onAction('add-point', undefined, { recipientSeat: null, isHost: true, entity: e });
    expect(comp.state.points.length).toBe(before + 1);
    const added = comp.state.points[comp.state.points.length - 1];
    expect(added.localPos).toEqual([0, 0, 0]);
    expect(added.localYaw).toBe(0);
    expect(added.snapRotation).toBe(false);
    expect(added.radius).toBeGreaterThan(0);
    expect(added.id).toBeTruthy();
  });

  test('delete-point removes the matching point', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a' }), pt({ id: 'b' })] });
    comp.onAction('delete-point', { pointId: 'a' }, { recipientSeat: null, isHost: true, entity: e });
    expect(comp.state.points.map(p => p.id)).toEqual(['b']);
  });

  test('edit-x / edit-y / edit-z update localPos coordinates independently', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a', localPos: [0, 0, 0] })] });
    const c = { recipientSeat: null, isHost: true, entity: e };
    comp.onAction('edit-x', { pointId: 'a', value: 1.5 }, c);
    comp.onAction('edit-y', { pointId: 'a', value: 2.5 }, c);
    comp.onAction('edit-z', { pointId: 'a', value: 3.5 }, c);
    expect(comp.state.points[0].localPos).toEqual([1.5, 2.5, 3.5]);
  });

  test('edit-yaw / edit-radius / edit-rot / edit-snap-y update the right fields', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a' })] });
    const c = { recipientSeat: null, isHost: true, entity: e };
    comp.onAction('edit-yaw',    { pointId: 'a', value: 1.2 },  c);
    comp.onAction('edit-radius', { pointId: 'a', value: 0.9 },  c);
    comp.onAction('edit-rot',    { pointId: 'a', value: true }, c);
    comp.onAction('edit-snap-y', { pointId: 'a', value: true }, c);
    expect(comp.state.points[0].localYaw).toBe(1.2);
    expect(comp.state.points[0].radius).toBe(0.9);
    expect(comp.state.points[0].snapRotation).toBe(true);
    expect(comp.state.points[0].snapY).toBe(true);
  });

  test("config row exposes a 'snap y' boolean wired to edit-snap-y", () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a', snapY: true })] });
    const items = comp.onEditorTools({ recipientSeat: null, isHost: true, entity: e });
    const config = items[2] as Extract<EditorToolItem, { kind: 'row' }>;
    const ySwitch = config.items.find(
      (i): i is Extract<EditorToolItem, { kind: 'boolean' }> => i.kind === 'boolean' && i.id === 'edit-snap-y',
    );
    expect(ySwitch).toBeDefined();
    expect(ySwitch!.value).toBe(true);
  });

  test('edit-radius clamps negatives to zero', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a', radius: 0.5 })] });
    comp.onAction('edit-radius', { pointId: 'a', value: -1 }, { recipientSeat: null, isHost: true, entity: e });
    expect(comp.state.points[0].radius).toBe(0);
  });

  test('edit-* with mismatched pointId is a no-op', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a', localPos: [0, 0, 0] })] });
    const before = comp.state.points[0];
    comp.onAction('edit-x', { pointId: 'nope', value: 9 }, { recipientSeat: null, isHost: true, entity: e });
    expect(comp.state.points[0]).toEqual(before);
  });

  test('editor edit drives visualization rebuild (snapRotation flips arrow on)', () => {
    const e = scene.spawn('snap-marker', ctx);
    const comp = e.getComponent(SnapPointsComponent)!;
    comp.setState({ points: [pt({ id: 'a', snapRotation: false })] });
    expect((getGroup(comp).children[0] as THREE.Group).children.length).toBe(1);
    comp.onAction('edit-rot', { pointId: 'a', value: true }, { recipientSeat: null, isHost: true, entity: e });
    expect((getGroup(comp).children[0] as THREE.Group).children.length).toBe(2);
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
