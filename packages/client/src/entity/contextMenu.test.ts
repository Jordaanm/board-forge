import { describe, test, expect, beforeEach } from 'vitest';
import { Scene } from './Scene';
import { Entity } from './Entity';
import { EntityComponent, type MenuContext, type MenuItem, type ActionContext } from './EntityComponent';
import { ComponentRegistry, componentRegistry } from './ComponentRegistry';
import { aggregateContextMenu } from './contextMenu';

class A extends EntityComponent<object> {
  static typeId = 'a';
  onSpawn() {}
  onPropertiesChanged() {}
  onContextMenu(_ctx: MenuContext): MenuItem[] {
    return [{ kind: 'action', id: 'a-1', label: 'A One' }];
  }
}

class B extends EntityComponent<object> {
  static typeId = 'b';
  static requires = ['a'] as const;
  onSpawn() {}
  onPropertiesChanged() {}
  onContextMenu(): MenuItem[] {
    return [{ kind: 'action', id: 'b-1', label: 'B One' }];
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
  onContextMenu(): MenuItem[] {
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
  calls: Array<{ actionId: string; args?: object; ctx: ActionContext }> = [];
  onSpawn() {}
  onPropertiesChanged() {}
  onAction(actionId: string, args: object | undefined, ctx: ActionContext) {
    this.calls.push({ actionId, args, ctx });
  }
}

beforeEach(() => {
  Scene.clear();
  componentRegistry.clear();
  Scene.setRegistry(componentRegistry);
});

function spawn(id: string, cls: { typeId: string; requires?: readonly string[] } | { typeId: string; requires?: readonly string[] }[]): Entity {
  const e = new Entity({ id, type: 'thing', name: id });
  const list = Array.isArray(cls) ? cls : [cls];
  for (const c of list) {
    const comp = new (c as unknown as { new (): EntityComponent<object> })();
    comp.state = {} as object;
    e.attachComponent(comp);
  }
  Scene.add(e);
  return e;
}

describe('aggregateContextMenu', () => {
  test('walks components in topo order, separator between non-empty groups', () => {
    componentRegistry.register(A);
    componentRegistry.register(B);
    const e = spawn('e1', [B, A]); // attach order shouldn't matter
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    expect(items.map(i => i.kind)).toEqual(['action', 'separator', 'action']);
    expect((items[0] as { id: string }).id).toBe('a-1');
    expect((items[2] as { id: string }).id).toBe('b-1');
  });

  test('skips components whose onContextMenu returns []', () => {
    componentRegistry.register(A);
    componentRegistry.register(Empty);
    const e = spawn('e1', [A, Empty]);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    expect(items.map(i => i.kind)).toEqual(['action']);
  });

  test('inserts no leading or trailing separator', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    expect(items[0].kind).toBe('action');
    expect(items[items.length - 1].kind).toBe('action');
  });

  test('spectator (no seat, not host) gets empty menu', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: null, isHost: false, entity: e });
    expect(items).toEqual([]);
  });

  test('seated guest still gets the menu', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: 2, isHost: false, entity: e });
    expect(items).toHaveLength(1);
  });

  test('host always gets the menu (no seat required)', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    const items = aggregateContextMenu(e, { recipientSeat: null, isHost: true, entity: e });
    expect(items).toHaveLength(1);
  });

  test('actions are tagged with the owning component typeId', () => {
    componentRegistry.register(A);
    componentRegistry.register(B);
    const e = spawn('e1', [A, B]);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    const aItem = items[0] as MenuItem & { kind: 'action' };
    const bItem = items[2] as MenuItem & { kind: 'action' };
    expect(aItem.componentTypeId).toBe('a');
    expect(bItem.componentTypeId).toBe('b');
  });

  test('submenu items inherit componentTypeId recursively', () => {
    componentRegistry.register(Sub);
    const e = spawn('e1', Sub);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    const sub = items[0] as MenuItem & { kind: 'submenu' };
    expect(sub.kind).toBe('submenu');
    const child = sub.items[0] as MenuItem & { kind: 'action' };
    expect(child.componentTypeId).toBe('sub');
  });

  test('entity with no components → empty menu', () => {
    const e = new Entity({ id: 'lonely', type: 't', name: 'lonely' });
    Scene.add(e);
    expect(aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e })).toEqual([]);
  });

  test('CallTracker.onAction receives actionId + args + ctx', () => {
    componentRegistry.register(CallTracker);
    const e = spawn('e1', CallTracker);
    const tracker = e.components.get('tracker') as CallTracker;
    const ctx: ActionContext = { recipientSeat: 1, isHost: false, entity: e };
    tracker.onAction('roll', { count: 3 }, ctx);
    expect(tracker.calls).toEqual([{ actionId: 'roll', args: { count: 3 }, ctx }]);
  });
});
