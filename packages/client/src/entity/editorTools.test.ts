import { describe, test, expect, beforeEach } from 'vitest';
import { SceneImpl } from './Scene';
import { Entity } from './Entity';
import { EntityComponent, type MenuContext, type ActionContext } from './EntityComponent';
import { componentRegistry } from './ComponentRegistry';
import { aggregateEditorTools, dispatchEditorTool, type EditorToolItem } from './editorTools';

let scene: SceneImpl;

class A extends EntityComponent<object> {
  static typeId = 'a';
  onSpawn() {}
  onPropertiesChanged() {}
  onEditorTools(_ctx: MenuContext): EditorToolItem[] {
    return [{ kind: 'button', id: 'a-btn', label: 'A Button' }];
  }
}

class B extends EntityComponent<object> {
  static typeId = 'b';
  static requires = ['a'] as const;
  onSpawn() {}
  onPropertiesChanged() {}
  onEditorTools(): EditorToolItem[] {
    return [{ kind: 'button', id: 'b-btn', label: 'B Button' }];
  }
}

class Empty extends EntityComponent<object> {
  static typeId = 'empty';
  onSpawn() {}
  onPropertiesChanged() {}
}

class Dispatcher extends EntityComponent<object> {
  static typeId = 'dispatcher';
  calls: Array<{ actionId: string; args?: object; ctx: ActionContext }> = [];
  onSpawn() {}
  onPropertiesChanged() {}
  onEditorTools(): EditorToolItem[] {
    return [{ kind: 'button', id: 'do-thing', label: 'Do Thing' }];
  }
  onAction(actionId: string, args: object | undefined, ctx: ActionContext) {
    this.calls.push({ actionId, args, ctx });
  }
}

beforeEach(() => {
  scene = new SceneImpl();
  componentRegistry.clear();
  scene.setRegistry(componentRegistry);
});

function spawn(id: string, cls: { typeId: string; requires?: readonly string[] }[] | { typeId: string; requires?: readonly string[] }): Entity {
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

describe('aggregateEditorTools', () => {
  test('walks components in topo order, no separator between groups', () => {
    componentRegistry.register(A);
    componentRegistry.register(B);
    const e = spawn('e1', [B, A]);
    const items = aggregateEditorTools(e, { recipientSeat: 0, isHost: true, entity: e });
    expect(items.map(i => i.kind)).toEqual(['button', 'button']);
    expect((items[0] as { id: string }).id).toBe('a-btn');
    expect((items[1] as { id: string }).id).toBe('b-btn');
  });

  test('skips components whose onEditorTools returns []', () => {
    componentRegistry.register(A);
    componentRegistry.register(Empty);
    const e = spawn('e1', [A, Empty]);
    const items = aggregateEditorTools(e, { recipientSeat: 0, isHost: true, entity: e });
    expect(items.map(i => i.kind)).toEqual(['button']);
  });

  test('non-host gets empty list (panel is host-only)', () => {
    componentRegistry.register(A);
    const e = spawn('e1', A);
    expect(aggregateEditorTools(e, { recipientSeat: 0, isHost: false, entity: e })).toEqual([]);
    expect(aggregateEditorTools(e, { recipientSeat: null, isHost: false, entity: e })).toEqual([]);
  });

  test('buttons tagged with the owning component typeId', () => {
    componentRegistry.register(A);
    componentRegistry.register(B);
    const e = spawn('e1', [A, B]);
    const items = aggregateEditorTools(e, { recipientSeat: 0, isHost: true, entity: e });
    const a = items[0] as EditorToolItem & { kind: 'button' };
    const b = items[1] as EditorToolItem & { kind: 'button' };
    expect(a.componentTypeId).toBe('a');
    expect(b.componentTypeId).toBe('b');
  });

  test('entity with no components → empty list', () => {
    const e = new Entity({ id: 'lonely', type: 't', name: 'lonely' });
    scene.add(e);
    expect(aggregateEditorTools(e, { recipientSeat: 0, isHost: true, entity: e })).toEqual([]);
  });
});

describe('dispatchEditorTool', () => {
  test('component-defined buttons fall through to onAction on the owning component', () => {
    componentRegistry.register(Dispatcher);
    const e = spawn('e1', Dispatcher);
    const tracker = e.components.get('dispatcher') as Dispatcher;
    const items = aggregateEditorTools(e, { recipientSeat: 0, isHost: true, entity: e });
    const item = items[0] as EditorToolItem & { kind: 'button' };

    let attachCalls = 0;
    dispatchEditorTool(item, undefined, e.id, {
      entity:    e,
      hostLocal: { attachSurface: () => { attachCalls++; }, attachElement: () => {} },
    });
    expect(attachCalls).toBe(0);
    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0].actionId).toBe('do-thing');
    expect(tracker.calls[0].ctx.isHost).toBe(true);
  });

  test('mesh add-surface routes to hostLocal.attachSurface, not onAction', () => {
    let calledWith: string | null = null;
    const item: EditorToolItem & { kind: 'button' } = {
      kind: 'button', id: 'add-surface', label: 'Add Surface', componentTypeId: 'mesh',
    };
    const e = new Entity({ id: 'parent-1', type: 't', name: 'p' });
    dispatchEditorTool(item, undefined, e.id, {
      entity:    e,
      hostLocal: { attachSurface: (id) => { calledWith = id; }, attachElement: () => {} },
    });
    expect(calledWith).toBe('parent-1');
  });

  test('surface add-rich/image/shape-* route to hostLocal.attachElement with the right kind', () => {
    const e = new Entity({ id: 'surface-1', type: 's', name: 's' });
    const cases: Array<[string, 'rich' | 'image' | 'shape-rect' | 'shape-circle' | 'button']> = [
      ['add-rich',         'rich'],
      ['add-image',        'image'],
      ['add-shape-rect',   'shape-rect'],
      ['add-shape-circle', 'shape-circle'],
      ['add-button',       'button'],
    ];
    for (const [actionId, kind] of cases) {
      let calledWith: { id: string; kind: string } | null = null;
      const item: EditorToolItem & { kind: 'button' } = {
        kind: 'button', id: actionId, label: 'x', componentTypeId: 'surface',
      };
      dispatchEditorTool(item, undefined, e.id, {
        entity:    e,
        hostLocal: {
          attachSurface: () => {},
          attachElement: (id, k) => { calledWith = { id, kind: k }; },
        },
      });
      expect(calledWith).toEqual({ id: 'surface-1', kind });
    }
  });

  test('button without componentTypeId is dropped (no entity, no callback)', () => {
    const item: EditorToolItem & { kind: 'button' } = {
      kind: 'button', id: 'orphan', label: 'Orphan',
    };
    let attachCalls = 0;
    dispatchEditorTool(item, undefined, 'e', {
      entity:    undefined,
      hostLocal: { attachSurface: () => { attachCalls++; }, attachElement: () => {} },
    });
    expect(attachCalls).toBe(0);
  });
});
