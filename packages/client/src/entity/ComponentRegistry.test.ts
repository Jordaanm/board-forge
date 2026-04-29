import { describe, test, expect, beforeEach } from 'vitest';
import {
  ComponentRegistry,
  topoSortComponents,
} from './ComponentRegistry';
import { EntityComponent, type ComponentClass } from './EntityComponent';

// Minimal concrete component class used by tests below.
function makeComp(typeId: string, requires: string[] = []): ComponentClass {
  class C extends EntityComponent<{}> {
    onSpawn() {}
    onPropertiesChanged() {}
  }
  (C as any).typeId   = typeId;
  (C as any).requires = requires;
  return C as unknown as ComponentClass;
}

describe('topoSortComponents', () => {
  test('linear chain: A → B → C produces A, B, C', () => {
    const A = makeComp('A');
    const B = makeComp('B', ['A']);
    const C = makeComp('C', ['B']);
    const order = topoSortComponents([C, B, A]);
    expect(order.map(c => c.typeId)).toEqual(['A', 'B', 'C']);
  });

  test('diamond: D requires B and C; both require A', () => {
    const A = makeComp('A');
    const B = makeComp('B', ['A']);
    const C = makeComp('C', ['A']);
    const D = makeComp('D', ['B', 'C']);
    const order = topoSortComponents([D, C, B, A]);
    const idx = (id: string) => order.findIndex(c => c.typeId === id);
    expect(idx('A')).toBeLessThan(idx('B'));
    expect(idx('A')).toBeLessThan(idx('C'));
    expect(idx('B')).toBeLessThan(idx('D'));
    expect(idx('C')).toBeLessThan(idx('D'));
  });

  test('cycle throws', () => {
    const A = makeComp('A', ['B']);
    const B = makeComp('B', ['A']);
    expect(() => topoSortComponents([A, B])).toThrow(/cycle/i);
  });

  test('missing dependency throws', () => {
    const A = makeComp('A', ['MISSING']);
    expect(() => topoSortComponents([A])).toThrow(/missing typeId: MISSING/);
  });
});

describe('ComponentRegistry', () => {
  let reg: ComponentRegistry;
  beforeEach(() => { reg = new ComponentRegistry(); });

  test('register + get round-trips', () => {
    const A = makeComp('A');
    reg.register(A);
    expect(reg.get('A')).toBe(A);
    expect(reg.has('A')).toBe(true);
    expect(reg.has('Z')).toBe(false);
  });

  test('register rejects duplicate typeId', () => {
    reg.register(makeComp('A'));
    expect(() => reg.register(makeComp('A'))).toThrow(/already registered/);
  });

  test('register rejects empty typeId', () => {
    const Bad = makeComp('');
    expect(() => reg.register(Bad)).toThrow(/missing static typeId/);
  });

  test('register validates requires against already-registered classes', () => {
    const A = makeComp('A');
    const B = makeComp('B', ['A']);
    // B before A should fail.
    expect(() => reg.register(B)).toThrow(/requires unknown typeId: A/);
    // A then B is fine.
    reg.register(A);
    reg.register(B);
    expect(reg.get('B')).toBe(B);
  });

  test('getSpawnOrder returns topo order and caches by sorted-set key', () => {
    const A = makeComp('A');
    const B = makeComp('B', ['A']);
    const C = makeComp('C', ['B']);
    reg.register(A); reg.register(B); reg.register(C);

    const o1 = reg.getSpawnOrder(['C', 'A', 'B']);
    expect(o1.map(c => c.typeId)).toEqual(['A', 'B', 'C']);

    // Second call with a permuted input returns the cached array (same reference).
    const o2 = reg.getSpawnOrder(['B', 'C', 'A']);
    expect(o2).toBe(o1);
  });

  test('getSpawnOrder throws on unknown typeId', () => {
    expect(() => reg.getSpawnOrder(['Nope'])).toThrow(/Unknown component typeId: Nope/);
  });

  test('clear empties the registry and the order cache', () => {
    reg.register(makeComp('A'));
    reg.clear();
    expect(reg.has('A')).toBe(false);
  });
});
