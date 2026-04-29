import { describe, test, expect } from 'vitest';
import { Entity, defaultEntityName } from './Entity';
import { EntityComponent } from './EntityComponent';

describe('defaultEntityName', () => {
  test('uses the first 8 chars of the GUID', () => {
    expect(defaultEntityName('Die', '7a3e9f12-1234-5678-9abc-def012345678')).toBe('Die-7a3e9f12');
  });

  test('handles short GUIDs without padding', () => {
    expect(defaultEntityName('Token', 'abc')).toBe('Token-abc');
  });
});

describe('Entity', () => {
  test('initialises defaults for omitted fields', () => {
    const e = new Entity({ id: 'a', type: 'die', name: 'Die-aaaaaaaa' });
    expect(e.tags).toEqual([]);
    expect(e.owner).toBeNull();
    expect(e.privateToSeat).toBeNull();
    expect(e.parentId).toBeNull();
    expect(e.children).toEqual([]);
    expect(e.heldBy).toBeNull();
    expect(e.components.size).toBe(0);
  });

  test('copies tag/children arrays so callers can mutate the source', () => {
    const tags = ['a', 'b'];
    const children = ['c1'];
    const e = new Entity({ id: 'a', type: 'x', name: 'x', tags, children });
    tags.push('mutation');
    children.push('c2');
    expect(e.tags).toEqual(['a', 'b']);
    expect(e.children).toEqual(['c1']);
  });

  test('attachComponent sets entity backref + indexes by typeId', () => {
    class TestComp extends EntityComponent<{ x: number }> {
      static typeId = 'test';
      onSpawn() {}
      onPropertiesChanged() {}
    }
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    const comp = new TestComp();
    comp.state = { x: 1 };
    e.attachComponent(comp);
    expect(e.components.get('test')).toBe(comp);
    expect(comp.entity).toBe(e);
    expect(e.getComponent(TestComp)).toBe(comp);
    expect(e.hasComponent(TestComp)).toBe(true);
  });

  test('attachComponent rejects duplicate typeId', () => {
    class TestComp extends EntityComponent<{}> {
      static typeId = 'test';
      onSpawn() {}
      onPropertiesChanged() {}
    }
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    e.attachComponent(new TestComp());
    expect(() => e.attachComponent(new TestComp())).toThrow(/already has component/);
  });
});

describe('EntityComponent', () => {
  test('setState merges into state and fires onPropertiesChanged once', () => {
    let calls: Partial<{ a: number; b: number }>[] = [];
    class TestComp extends EntityComponent<{ a: number; b: number }> {
      static typeId = 'test';
      onSpawn() {}
      onPropertiesChanged(changed: Partial<{ a: number; b: number }>) {
        calls.push(changed);
      }
    }
    const c = new TestComp();
    c.state = { a: 1, b: 2 };
    c.setState({ a: 10, b: 20 });
    expect(c.state).toEqual({ a: 10, b: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ a: 10, b: 20 });
  });

  test('applyRemoteState behaves like setState (merge + hook)', () => {
    let calls = 0;
    class TestComp extends EntityComponent<{ a: number }> {
      static typeId = 'test';
      onSpawn() {}
      onPropertiesChanged() { calls++; }
    }
    const c = new TestComp();
    c.state = { a: 1 };
    c.applyRemoteState({ a: 5 });
    expect(c.state.a).toBe(5);
    expect(calls).toBe(1);
  });

  test('toJSON / fromJSON walk only state', () => {
    class TestComp extends EntityComponent<{ a: number; b: string }> {
      static typeId = 'test';
      onSpawn() {}
      onPropertiesChanged() {}
    }
    const c1 = new TestComp();
    c1.state = { a: 7, b: 'hi' };
    const json = c1.toJSON();
    expect(json).toEqual({ a: 7, b: 'hi' });

    const c2 = new TestComp();
    c2.fromJSON(json);
    expect(c2.state).toEqual({ a: 7, b: 'hi' });
    // Independent copies — mutating c1 doesn't bleed into c2.
    c1.state.a = 99;
    expect(c2.state.a).toBe(7);
  });

  test('static defaults: requires=[], channel=reliable', () => {
    expect(EntityComponent.requires).toEqual([]);
    expect(EntityComponent.channel).toBe('reliable');
  });
});
