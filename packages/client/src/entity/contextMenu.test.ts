import { describe, test, expect, beforeEach } from 'vitest';
import { SceneImpl } from './Scene';
import { Entity } from './Entity';
import { EntityComponent, type MenuItem, type ActionContext, type ActionDefinition } from './EntityComponent';
import { componentRegistry } from './ComponentRegistry';
import { aggregateContextMenu } from './contextMenu';
import { DEFAULT_PREFERENCES } from '../preferences/types';

let scene: SceneImpl;

class A extends EntityComponent<object> {
  static typeId = 'a';
  onSpawn() {}
  onPropertiesChanged() {}
  getActions(_ctx: ActionContext): ActionDefinition[] {
    return [{ name: 'a-1', label: 'A One' }];
  }
}

class B extends EntityComponent<object> {
  static typeId = 'b';
  static requires = ['a'] as const;
  onSpawn() {}
  onPropertiesChanged() {}
  getActions(): ActionDefinition[] {
    return [{ name: 'b-1', label: 'B One' }];
  }
}

class Empty extends EntityComponent<object> {
  static typeId = 'empty';
  onSpawn() {}
  onPropertiesChanged() {}
  // default no-op
}

class Sub extends EntityComponent<object> {
  static typeId = 'sub';
  onSpawn() {}
  onPropertiesChanged() {}
  getMenuControls(): MenuItem[] {
    return [{
      kind: 'submenu', label: 'Roll',
      items: [
        { kind: 'action', id: '1', label: '1' },
        { kind: 'action', id: 'custom', label: 'Custom…' },
      ],
    }];
  }
}

class CallTracker extends EntityComponent<{ count: number }> {
  static typeId = 'tracker';
  calls: Array<{ name: string; ctx: ActionContext }> = [];
  onSpawn() {}
  onPropertiesChanged() {}
  onAction(name: string, ctx: ActionContext) {
    this.calls.push({ name, ctx });
  }
}

beforeEach(() => {
  scene = new SceneImpl();
  componentRegistry.clear();
  scene.setRegistry(componentRegistry);
});

function spawn(id: string, cls: { typeId: string; requires?: readonly string[] } | { typeId: string; requires?: readonly string[] }[]): Entity {
  const e = new Entity({ id, type: 'thing', name: id });
  const list = Array.isArray(cls) ? cls : [cls];
  for (const c of list) {
    const comp = new (c as unknown as { new (): EntityComponent<object> })();
    comp.state = {} as object;
    e.attachComponent(comp);
  }
  scene.add(e);
  return e;
}

describe('aggregateContextMenu', () => {
  test('walks components in topo order, separator between non-empty groups', () => {
    componentRegistry.register(A);
    componentRegistry.register(B);
    const e = spawn('e1', [B, A]); // attach order shouldn't matter
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES });
    expect(items.map(i => i.kind)).toEqual(['action', 'separator', 'action']);
    expect((items[0] as { id: string }).id).toBe('a-1');
    expect((items[2] as { id: string }).id).toBe('b-1');
  });

  test('skips components whose onContextMenu returns []', () => {
    componentRegistry.register(A);
    componentRegistry.register(Empty);
    const e = spawn('e1', [A, Empty]);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES });
    expect(items.map(i => i.kind)).toEqual(['action']);
  });

  test('inserts no leading or trailing separator', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES });
    expect(items[0].kind).toBe('action');
    expect(items[items.length - 1].kind).toBe('action');
  });

  test('spectator (no seat, not host) gets empty menu', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: null, isHost: false, entity: e, preferences: DEFAULT_PREFERENCES });
    expect(items).toEqual([]);
  });

  test('seated guest still gets the menu', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: 2, isHost: false, entity: e, preferences: DEFAULT_PREFERENCES });
    expect(items).toHaveLength(1);
  });

  test('host always gets the menu (no seat required)', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: null, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES });
    expect(items).toHaveLength(1);
  });

  test('actions are tagged with the owning component typeId', () => {
    componentRegistry.register(A);
    componentRegistry.register(B);
    const e = spawn('e1', [A, B]);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES });
    const aItem = items[0] as MenuItem & { kind: 'action' };
    const bItem = items[2] as MenuItem & { kind: 'action' };
    expect(aItem.componentTypeId).toBe('a');
    expect(bItem.componentTypeId).toBe('b');
  });

  test('submenu items inherit componentTypeId recursively', () => {
    componentRegistry.register(Sub);
    const e = spawn('e1', Sub);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES });
    const sub = items[0] as MenuItem & { kind: 'submenu' };
    expect(sub.kind).toBe('submenu');
    const child = sub.items[0] as MenuItem & { kind: 'action' };
    expect(child.componentTypeId).toBe('sub');
  });

  test('entity with no components → empty menu', () => {
    const e = new Entity({ id: 'lonely', type: 't', name: 'lonely' });
    scene.add(e);
    expect(aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e, preferences: DEFAULT_PREFERENCES })).toEqual([]);
  });

  test('CallTracker.onAction receives name + ctx', () => {
    componentRegistry.register(CallTracker);
    const e = spawn('e1', CallTracker);
    const tracker = e.components.get('tracker') as CallTracker;
    const ctx: ActionContext = {
      recipientSeat: 1, isHost: false, entity: e,
      preferences:   DEFAULT_PREFERENCES,
    };
    tracker.onAction('roll', ctx);
    expect(tracker.calls).toEqual([{ name: 'roll', ctx }]);
  });
});
