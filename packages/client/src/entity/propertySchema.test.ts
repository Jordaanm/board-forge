// Aggregator coverage for issue #1 of issues--property-schema-refactor.md.
// The aggregator walks an entity's components in topological onSpawn order and
// returns one section per component that declared a `propertySchema`, with
// `condition` and `hostOnly` predicates already evaluated.

import { describe, test, expect, beforeEach } from 'vitest';
import { SceneImpl } from './Scene';
import { Entity } from './Entity';
import { EntityComponent } from './EntityComponent';
import { componentRegistry } from './ComponentRegistry';
import {
  aggregatePropertySchema,
  getPropertySchema,
  type PropertyDef,
} from './propertySchema';

interface AState { a: number }
interface BState { b: string; gated: boolean }
interface CState { secret: string }

class CompA extends EntityComponent<AState> {
  static typeId = 'a';
  static label  = 'A Section';
  static propertySchema: readonly PropertyDef<AState>[] = [
    { key: 'a', label: 'A', type: 'number' },
  ];
  onSpawn() {}
  onPropertiesChanged() {}
}

class CompB extends EntityComponent<BState> {
  static typeId   = 'b';
  static requires = ['a'] as const;
  static label    = 'B Section';
  static propertySchema: readonly PropertyDef<BState>[] = [
    { key: 'b',     label: 'B',     type: 'string' },
    {
      key:       'gated',
      label:     'Gated',
      type:      'boolean',
      condition: (state) => state.gated,
    },
    {
      key:       'whenOwned',
      label:     'When Owned',
      type:      'string',
      condition: (_state, entity) => entity.owner !== null,
    },
  ];
  onSpawn() {}
  onPropertiesChanged() {}
}

class CompC extends EntityComponent<CState> {
  static typeId = 'c';
  static label  = 'C Section';
  static propertySchema: readonly PropertyDef<CState>[] = [
    { key: 'secret', label: 'Secret', type: 'string', hostOnly: true },
    { key: 'shared', label: 'Shared', type: 'string' },
  ];
  onSpawn() {}
  onPropertiesChanged() {}
}

class CompEmpty extends EntityComponent<object> {
  static typeId = 'empty';
  static label  = 'Empty Section';
  static propertySchema: readonly PropertyDef[] = [];
  onSpawn() {}
  onPropertiesChanged() {}
}

class CompUnmigrated extends EntityComponent<object> {
  static typeId = 'unmigrated';
  // No `static label`, no `static propertySchema` — should be skipped.
  onSpawn() {}
  onPropertiesChanged() {}
}

let scene: SceneImpl;

beforeEach(() => {
  componentRegistry.clear();
  componentRegistry.register(CompA);
  componentRegistry.register(CompB);
  componentRegistry.register(CompC);
  componentRegistry.register(CompEmpty);
  componentRegistry.register(CompUnmigrated);
  scene = new SceneImpl();
});

function makeEntity(comps: Array<{ cls: { new(): EntityComponent<any>; typeId: string }; state: object }>): Entity {
  const e = new Entity({ id: 'e1', type: 't', name: 'E1' });
  for (const c of comps) {
    const inst = new c.cls();
    inst.fromJSON(c.state);
    e.attachComponent(inst);
  }
  scene.add(e);
  return e;
}

describe('aggregatePropertySchema — topological ordering', () => {
  test('B (requires A) sorts after A regardless of attachment order', () => {
    const e = makeEntity([
      { cls: CompB as any, state: { b: '', gated: false } },
      { cls: CompA as any, state: { a: 0 } },
    ]);

    const sections = aggregatePropertySchema(e, { isHost: true });
    const ids = sections.map(s => s.typeId);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });
});

describe('aggregatePropertySchema — condition filtering', () => {
  test('predicate over component state hides the row when false', () => {
    const e = makeEntity([
      { cls: CompA as any, state: { a: 0 } },
      { cls: CompB as any, state: { b: 'x', gated: false } },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: true });
    const bSection = sections.find(s => s.typeId === 'b')!;
    const keys = bSection.entries.map(e => e.key);
    expect(keys).not.toContain('gated');
  });

  test('predicate over component state shows the row when true', () => {
    const e = makeEntity([
      { cls: CompA as any, state: { a: 0 } },
      { cls: CompB as any, state: { b: 'x', gated: true } },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: true });
    const bSection = sections.find(s => s.typeId === 'b')!;
    const keys = bSection.entries.map(e => e.key);
    expect(keys).toContain('gated');
  });

  test('predicate over entity field gates visibility', () => {
    const e = makeEntity([
      { cls: CompA as any, state: { a: 0 } },
      { cls: CompB as any, state: { b: 'x', gated: false } },
    ]);
    const before = aggregatePropertySchema(e, { isHost: true })
      .find(s => s.typeId === 'b')!.entries.map(e => e.key);
    expect(before).not.toContain('whenOwned');

    e.owner = 0;
    const after = aggregatePropertySchema(e, { isHost: true })
      .find(s => s.typeId === 'b')!.entries.map(e => e.key);
    expect(after).toContain('whenOwned');
  });
});

describe('aggregatePropertySchema — hostOnly filtering', () => {
  test('host context sees host-only rows', () => {
    const e = makeEntity([
      { cls: CompC as any, state: { secret: 's', shared: 'p' } },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: true });
    const keys = sections.find(s => s.typeId === 'c')!.entries.map(e => e.key);
    expect(keys).toEqual(['secret', 'shared']);
  });

  test('guest context omits host-only rows entirely', () => {
    const e = makeEntity([
      { cls: CompC as any, state: { secret: 's', shared: 'p' } },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: false });
    const keys = sections.find(s => s.typeId === 'c')!.entries.map(e => e.key);
    expect(keys).toEqual(['shared']);
  });
});

describe('aggregatePropertySchema — empty section preservation', () => {
  test('component with empty propertySchema still gets a section', () => {
    const e = makeEntity([
      { cls: CompEmpty as any, state: {} },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: true });
    expect(sections).toHaveLength(1);
    expect(sections[0].typeId).toBe('empty');
    expect(sections[0].entries).toHaveLength(0);
    expect(sections[0].label).toBe('Empty Section');
  });

  test('component fully filtered out by host-only still gets an empty section', () => {
    class HostOnlyC extends EntityComponent<{ x: string }> {
      static typeId = 'hoc';
      static label  = 'Host Only Comp';
      static propertySchema: readonly PropertyDef[] = [
        { key: 'x', label: 'X', type: 'string', hostOnly: true },
      ];
      onSpawn() {}
      onPropertiesChanged() {}
    }
    componentRegistry.register(HostOnlyC);

    const e = makeEntity([
      { cls: HostOnlyC as any, state: { x: 'hi' } },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: false });
    expect(sections).toHaveLength(1);
    expect(sections[0].entries).toHaveLength(0);
  });
});

describe('aggregatePropertySchema — unmigrated components', () => {
  test('component without propertySchema or label is skipped', () => {
    const e = makeEntity([
      { cls: CompA as any,           state: { a: 0 } },
      { cls: CompUnmigrated as any,  state: {} },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: true });
    const ids = sections.map(s => s.typeId);
    expect(ids).toEqual(['a']);
  });

  test('entity with only unmigrated components yields no sections', () => {
    const e = makeEntity([
      { cls: CompUnmigrated as any, state: {} },
    ]);
    const sections = aggregatePropertySchema(e, { isHost: true });
    expect(sections).toEqual([]);
  });
});

describe('getPropertySchema', () => {
  test('returns empty array when class declares none', () => {
    expect(getPropertySchema(CompUnmigrated as any)).toEqual([]);
  });

  test('returns the declared array', () => {
    const schema = getPropertySchema(CompA as any);
    expect(schema).toHaveLength(1);
    expect(schema[0].key).toBe('a');
  });
});
