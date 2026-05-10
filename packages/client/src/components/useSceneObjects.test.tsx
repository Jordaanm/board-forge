// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Entity } from '../entity/Entity';
import { type SceneController } from '../entity/world';
import type { EntityHandle } from '../entity/world';
import { useSceneObjects } from './useSceneObjects';

// Synthesises a minimal SceneController surface with just the methods
// `useSceneObjects` reaches for. Concrete Entity instances are constructed
// (the hook calls aggregatePropertySchema, which wants a real Entity) but
// without components — sections collapse to [] which is enough to assert id /
// name / parent flow through entityToObjectSummary.
function makeFakeController(initial: Entity[]): {
  controller:   SceneController;
  setEntities:  (next: Entity[]) => void;
  fireSubscribe: () => void;
  unsubscribe:  ReturnType<typeof vi.fn>;
} {
  let entities = initial;
  const subscribers: Array<() => void> = [];
  const unsubscribe = vi.fn();
  const handles = (): EntityHandle[] => entities.map(e => ({
    id:           e.id,
    entity:       e,
  } as EntityHandle));
  const controller = {
    all:       () => handles(),
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => {
        unsubscribe();
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
  } as unknown as SceneController;

  return {
    controller,
    setEntities: (next) => { entities = next; },
    fireSubscribe: () => { for (const fn of subscribers) fn(); },
    unsubscribe,
  };
}

function makeEntity(id: string, name = id): Entity {
  return new Entity({ id, type: 'token', name });
}

afterEach(() => { /* renderHook cleans up automatically per test */ });

describe('useSceneObjects', () => {
  test('returns the controller\'s initial snapshot on first render', () => {
    const fake = makeFakeController([makeEntity('e-1', 'Alpha'), makeEntity('e-2', 'Beta')]);

    const { result } = renderHook(() => useSceneObjects(fake.controller, true));

    expect(result.current.map(o => o.id)).toEqual(['e-1', 'e-2']);
    expect(result.current[0].name).toBe('Alpha');
    expect(result.current[1].name).toBe('Beta');
  });

  test('updates when the controller\'s subscribe handler fires', () => {
    const fake = makeFakeController([makeEntity('e-1')]);
    const { result } = renderHook(() => useSceneObjects(fake.controller, true));
    expect(result.current).toHaveLength(1);

    act(() => {
      fake.setEntities([makeEntity('e-1'), makeEntity('e-2'), makeEntity('e-3')]);
      fake.fireSubscribe();
    });

    expect(result.current.map(o => o.id)).toEqual(['e-1', 'e-2', 'e-3']);
  });

  test('cleans up its subscription on unmount', () => {
    const fake = makeFakeController([makeEntity('e-1')]);
    const { unmount } = renderHook(() => useSceneObjects(fake.controller, true));

    expect(fake.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('returns an empty list when controller is null and does not throw', () => {
    const { result } = renderHook(() => useSceneObjects(null, true));
    expect(result.current).toEqual([]);
  });

  test('resubscribes when controller identity swaps (e.g. StrictMode remount)', () => {
    const a = makeFakeController([makeEntity('a-1')]);
    const b = makeFakeController([makeEntity('b-1'), makeEntity('b-2')]);

    const { result, rerender } = renderHook(
      ({ c }: { c: SceneController | null }) => useSceneObjects(c, true),
      { initialProps: { c: a.controller as SceneController | null } },
    );
    expect(result.current.map(o => o.id)).toEqual(['a-1']);

    rerender({ c: b.controller });
    expect(result.current.map(o => o.id)).toEqual(['b-1', 'b-2']);
    expect(a.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
