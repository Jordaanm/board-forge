import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Scene, entityToSerialized, type EntitySerialized } from './Scene';
import { Entity } from './Entity';
import { EntityComponent, type SpawnContext } from './EntityComponent';
import { ComponentRegistry } from './ComponentRegistry';

const ctx: SpawnContext = { scene: new THREE.Scene(), physics: null };

interface TransformState { x: number; y: number; z: number }
class TransformComp extends EntityComponent<TransformState> {
  static typeId   = 'transform';
  static channel  = 'unreliable' as const;
  spawnedAt = -1;
  onSpawn(): void { this.spawnedAt = TransformComp.spawnTick++; }
  onPropertiesChanged(): void {}
  static spawnTick = 0;
}

interface MeshState { meshRef: string }
class MeshComp extends EntityComponent<MeshState> {
  static typeId   = 'mesh';
  static requires = ['transform'];
  spawnedAt = -1;
  onSpawn(): void { this.spawnedAt = TransformComp.spawnTick++; }
  onPropertiesChanged(): void {}
}

// Component whose state holds a cross-entity GUID reference. Resolves it
// against Scene during onSpawn — this works only because phase 1 populates the
// scene fully before phase 2 fires onSpawn.
interface LinkState { targetId: string }
class LinkComp extends EntityComponent<LinkState> {
  static typeId = 'link';
  resolved: Entity | undefined;
  onSpawn(): void {
    this.resolved = Scene.getEntity(this.state.targetId);
  }
  onPropertiesChanged(): void {}
}

beforeEach(() => {
  Scene.clear();
  TransformComp.spawnTick = 0;
  // Per-test registry keeps the global componentRegistry untouched.
  const reg = new ComponentRegistry();
  reg.register(TransformComp);
  reg.register(MeshComp);
  reg.register(LinkComp);
  Scene.setRegistry(reg);
});

describe('Scene', () => {
  test('add + getEntity round-trips', () => {
    const e = new Entity({ id: 'a', type: 'die', name: 'd' });
    Scene.add(e);
    expect(Scene.getEntity('a')).toBe(e);
    expect(Scene.has('a')).toBe(true);
  });

  test('add rejects duplicate id', () => {
    Scene.add(new Entity({ id: 'a', type: 'x', name: 'x' }));
    expect(() => Scene.add(new Entity({ id: 'a', type: 'x', name: 'x' }))).toThrow(/already in scene/);
  });
});

describe('Scene.load — two-pass with cross-entity refs', () => {
  test('fully populates entities before any onSpawn runs', () => {
    // Two entities; entity B's LinkComp points at entity A.
    const snapshots: EntitySerialized[] = [
      {
        id: 'A', type: 'thing', name: 'A', tags: [], owner: null, privateToSeat: null,
        parentId: null, children: [],
        components: {
          transform: { x: 0, y: 0, z: 0 },
          mesh:      { meshRef: 'prim:cube' },
        },
      },
      {
        id: 'B', type: 'linker', name: 'B', tags: [], owner: null, privateToSeat: null,
        parentId: null, children: [],
        components: {
          link: { targetId: 'A' },
        },
      },
    ];
    const created = Scene.load(snapshots, ctx);
    expect(created).toHaveLength(2);
    const b = Scene.getEntity('B')!;
    const link = b.getComponent(LinkComp)!;
    expect(link.resolved?.id).toBe('A');
  });

  test('respects topological onSpawn order across requires', () => {
    const snapshots: EntitySerialized[] = [
      {
        id: 'X', type: 'thing', name: 'X', tags: [], owner: null, privateToSeat: null,
        parentId: null, children: [],
        components: {
          mesh:      { meshRef: 'prim:cube' },  // listed first deliberately
          transform: { x: 1, y: 2, z: 3 },
        },
      },
    ];
    Scene.load(snapshots, ctx);
    const x = Scene.getEntity('X')!;
    const t = x.getComponent(TransformComp)!;
    const m = x.getComponent(MeshComp)!;
    // transform must spawn before mesh because mesh requires transform.
    expect(t.spawnedAt).toBeLessThan(m.spawnedAt);
  });

  test('round-trip: serialise → load preserves entity + component state', () => {
    const e = new Entity({
      id: 'rt', type: 'die', name: 'Die-rt',
      tags: ['die', 'd6'], owner: 2, privateToSeat: 3,
      parentId: 'parent', children: ['c1', 'c2'],
    });
    const t = new TransformComp();
    t.state = { x: 1, y: 2, z: 3 };
    e.attachComponent(t);
    const m = new MeshComp();
    m.state = { meshRef: 'prim:cube' };
    e.attachComponent(m);

    const snap = entityToSerialized(e);
    Scene.clear();
    Scene.load([{
      ...snap,
      // Drop the parentId reference — the parent entity isn't in this snapshot
      // and the field is just data, not a ref to resolve at load time.
      parentId: 'parent',
    }], ctx);

    const restored = Scene.getEntity('rt')!;
    expect(restored.id).toBe('rt');
    expect(restored.type).toBe('die');
    expect(restored.name).toBe('Die-rt');
    expect(restored.tags).toEqual(['die', 'd6']);
    expect(restored.owner).toBe(2);
    expect(restored.privateToSeat).toBe(3);
    expect(restored.parentId).toBe('parent');
    expect(restored.children).toEqual(['c1', 'c2']);
    expect(restored.getComponent(TransformComp)!.state).toEqual({ x: 1, y: 2, z: 3 });
    expect(restored.getComponent(MeshComp)!.state).toEqual({ meshRef: 'prim:cube' });
  });

  test('throws on unknown component typeId in snapshot', () => {
    const snapshots: EntitySerialized[] = [{
      id: 'a', type: 'x', name: 'x', tags: [], owner: null, privateToSeat: null,
      parentId: null, children: [],
      components: { unknown: {} },
    }];
    expect(() => Scene.load(snapshots, ctx)).toThrow(/Unknown component typeId/);
  });
});
