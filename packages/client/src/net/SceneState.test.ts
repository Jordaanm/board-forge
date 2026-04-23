import { describe, test, expect } from 'vitest';
import { diffObjects, applyPatch, type ObjectState } from './SceneState';

function obj(id: string, px = 0, py = 0, pz = 0): ObjectState {
  return { id, objectType: 'token', px, py, pz, qx: 0, qy: 0, qz: 0, qw: 1 };
}

describe('diffObjects', () => {
  test('returns empty when nothing changed', () => {
    const state = [obj('a', 1)];
    expect(diffObjects(state, state)).toHaveLength(0);
  });

  test('detects position change above threshold', () => {
    expect(diffObjects([obj('a', 0)], [obj('a', 0.001)])).toHaveLength(1);
  });

  test('ignores change below threshold', () => {
    expect(diffObjects([obj('a', 0)], [obj('a', 0.00001)])).toHaveLength(0);
  });

  test('includes new objects', () => {
    expect(diffObjects([], [obj('a')])).toHaveLength(1);
  });

  test('respects custom threshold', () => {
    const prev = [obj('a', 0)];
    const curr = [obj('a', 0.05)];
    expect(diffObjects(prev, curr, 0.1)).toHaveLength(0);
    expect(diffObjects(prev, curr, 0.01)).toHaveLength(1);
  });
});

describe('applyPatch', () => {
  test('updates existing object', () => {
    const result = applyPatch([obj('a', 0)], [obj('a', 5)]);
    expect(result[0].px).toBe(5);
    expect(result).toHaveLength(1);
  });

  test('adds new objects not in base', () => {
    const result = applyPatch([obj('a')], [obj('b', 3)]);
    expect(result).toHaveLength(2);
    expect(result.find(o => o.id === 'b')?.px).toBe(3);
  });

  test('leaves unpatched objects unchanged', () => {
    const result = applyPatch([obj('a', 1), obj('b', 2)], [obj('b', 9)]);
    expect(result.find(o => o.id === 'a')?.px).toBe(1);
    expect(result.find(o => o.id === 'b')?.px).toBe(9);
  });

  test('applying sequence of patches produces expected final state', () => {
    let state = [obj('a', 0)];
    state = applyPatch(state, [obj('a', 1)]);
    state = applyPatch(state, [obj('a', 2)]);
    state = applyPatch(state, [obj('a', 3)]);
    expect(state[0].px).toBe(3);
  });

  test('snapshot then patches produces expected state', () => {
    const snapshot = [obj('a', 10), obj('b', 20)];
    let state = applyPatch([], snapshot);
    state = applyPatch(state, [obj('a', 11)]);
    state = applyPatch(state, [obj('b', 21)]);
    expect(state.find(o => o.id === 'a')?.px).toBe(11);
    expect(state.find(o => o.id === 'b')?.px).toBe(21);
  });
});
