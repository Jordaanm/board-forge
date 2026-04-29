import { describe, test, expect, beforeEach } from 'vitest';
import { Scene } from './Scene';
import { Entity } from './Entity';
import { EntityComponent } from './EntityComponent';
import { ComponentRegistry } from './ComponentRegistry';
import { applySceneMessage } from './GuestReceiver';

interface ValueState { v: number }
class ValueComp extends EntityComponent<ValueState> {
  static typeId = 'value';
  remotePatches: Partial<ValueState>[] = [];
  setStateCalls = 0;
  onSpawn() {}
  onPropertiesChanged(p: Partial<ValueState>) { this.remotePatches.push(p); }
}

beforeEach(() => {
  Scene.clear();
  const reg = new ComponentRegistry();
  reg.register(ValueComp);
  Scene.setRegistry(reg);
});

function spawnEntity(id: string, value = 0): Entity {
  const e = new Entity({ id, type: 'thing', name: id });
  const v = new ValueComp();
  v.state = { v: value };
  e.attachComponent(v);
  Scene.add(e);
  return e;
}

describe('applySceneMessage — component-patches', () => {
  test('routes per-component patches through applyRemoteState', () => {
    const e = spawnEntity('a', 0);
    applySceneMessage({
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'value', partial: { v: 7 } }],
    });
    const comp = e.getComponent(ValueComp)!;
    expect(comp.state.v).toBe(7);
    expect(comp.remotePatches).toEqual([{ v: 7 }]);
  });

  test('drops patches for unknown entities + components silently', () => {
    spawnEntity('a');
    expect(() => applySceneMessage({
      type: 'component-patches', channel: 'reliable',
      patches: [
        { entityId: 'missing', typeId: 'value', partial: { v: 1 } },
        { entityId: 'a',       typeId: 'unknown', partial: {} },
      ],
    })).not.toThrow();
  });
});

describe('applySceneMessage — entity-patch', () => {
  test('merges entity-level fields', () => {
    const e = spawnEntity('a');
    applySceneMessage({
      type: 'entity-patch',
      entityId: 'a',
      partial: { name: 'Renamed', tags: ['x', 'y'], owner: 3, privateToSeat: 1, parentId: 'p', children: ['c'] },
    });
    expect(e.name).toBe('Renamed');
    expect(e.tags).toEqual(['x', 'y']);
    expect(e.owner).toBe(3);
    expect(e.privateToSeat).toBe(1);
    expect(e.parentId).toBe('p');
    expect(e.children).toEqual(['c']);
  });

  test('omitted fields are not touched', () => {
    const e = spawnEntity('a');
    e.tags = ['original'];
    e.owner = 4;
    applySceneMessage({ type: 'entity-patch', entityId: 'a', partial: { name: 'Just Name' } });
    expect(e.tags).toEqual(['original']);
    expect(e.owner).toBe(4);
    expect(e.name).toBe('Just Name');
  });

  test('unknown entity is silently dropped', () => {
    expect(() => applySceneMessage({
      type: 'entity-patch', entityId: 'missing', partial: { name: 'X' },
    })).not.toThrow();
  });
});

describe('applySceneMessage — despawn-batch', () => {
  test('removes listed entities from the scene', () => {
    spawnEntity('parent');
    spawnEntity('child');
    applySceneMessage({ type: 'despawn-batch', entityIds: ['child', 'parent'] });
    expect(Scene.has('child')).toBe(false);
    expect(Scene.has('parent')).toBe(false);
  });
});

describe('applySceneMessage — invoke-action', () => {
  test('is ignored on guest (no state change, no throw)', () => {
    const e = spawnEntity('a', 5);
    applySceneMessage({
      type: 'invoke-action',
      entityId: 'a',
      componentTypeId: 'value',
      actionId: 'roll',
    });
    expect(e.getComponent(ValueComp)!.state.v).toBe(5);
  });
});

describe('applySceneMessage — hold-claim / hold-release', () => {
  test('hold-claim sets entity.heldBy', () => {
    const e = spawnEntity('a');
    applySceneMessage({ type: 'hold-claim', entityId: 'a', seat: 4 });
    expect(e.heldBy).toBe(4);
  });

  test('hold-release clears entity.heldBy', () => {
    const e = spawnEntity('a');
    e.heldBy = 4;
    applySceneMessage({ type: 'hold-release', entityId: 'a' });
    expect(e.heldBy).toBeNull();
  });
});
