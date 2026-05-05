import { describe, test, expect, beforeEach } from 'vitest';
import { SceneHistoryService, type LastLoaded } from './SceneHistoryService';
import { type EntitySerialized } from './Scene';

class FakeWorld {
  calls: EntitySerialized[][] = [];
  current: EntitySerialized[] = [];
  replaceScene(snaps: readonly EntitySerialized[]): void {
    this.calls.push([...snaps]);
    this.current = [...snaps];
  }
  snapshot(): EntitySerialized[] {
    return this.current.map(e => ({ ...e }));
  }
  setCurrent(snaps: EntitySerialized[]): void {
    this.current = snaps;
  }
}

function snap(id: string, value = '6'): EntitySerialized {
  return {
    id, type: 'die', name: id, tags: [],
    owner: null, privateToSeat: null, parentId: null, children: [],
    components: { value: { value, isNumeric: true } },
  };
}

const SAMPLE_SNAP: EntitySerialized[] = [
  {
    id: 'd-1', type: 'die', name: 'D', tags: [],
    owner: null, privateToSeat: null, parentId: null, children: [],
    components: { value: { value: '6', isNumeric: true } },
  },
];

const SAMPLE_LOAD: LastLoaded = {
  snapshot: SAMPLE_SNAP,
  filename: 'scene.json',
  savedAt:  '2026-05-06T12:00:00.000Z',
};

let world: FakeWorld;
let svc:   SceneHistoryService;

beforeEach(() => {
  world = new FakeWorld();
  svc   = new SceneHistoryService(world);
});

describe('SceneHistoryService — lastLoaded', () => {
  test('initial state is null', () => {
    expect(svc.lastLoaded).toBeNull();
  });

  test('setLastLoaded stores a copy of the snapshot', () => {
    svc.setLastLoaded(SAMPLE_LOAD);
    expect(svc.lastLoaded).not.toBeNull();
    expect(svc.lastLoaded!.filename).toBe('scene.json');
    expect(svc.lastLoaded!.snapshot).toEqual(SAMPLE_SNAP);
    // Defensive copy: caller mutating the original array doesn't change the stored snapshot.
    expect(svc.lastLoaded!.snapshot).not.toBe(SAMPLE_SNAP);
  });

  test('dispose clears lastLoaded', () => {
    svc.setLastLoaded(SAMPLE_LOAD);
    svc.dispose();
    expect(svc.lastLoaded).toBeNull();
  });
});

describe('SceneHistoryService — revert', () => {
  test('revert is a no-op when lastLoaded is null', () => {
    expect(svc.revert()).toBe(false);
    expect(world.calls).toEqual([]);
  });

  test('revert calls World.replaceScene with the stored snapshot', () => {
    svc.setLastLoaded(SAMPLE_LOAD);
    expect(svc.revert()).toBe(true);
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]).toEqual(SAMPLE_SNAP);
  });
});

describe('SceneHistoryService — subscription', () => {
  test('subscribers fire on setLastLoaded', () => {
    let calls = 0;
    svc.subscribe(() => { calls++; });
    svc.setLastLoaded(SAMPLE_LOAD);
    expect(calls).toBe(1);
  });

  test('returned unsubscribe stops further notifications', () => {
    let calls = 0;
    const off = svc.subscribe(() => { calls++; });
    off();
    svc.setLastLoaded(SAMPLE_LOAD);
    expect(calls).toBe(0);
  });
});

describe('SceneHistoryService — undo ring (issue #5)', () => {
  test('push captures world.snapshot under the supplied label', () => {
    world.setCurrent([snap('a')]);
    svc.push('first');
    expect(svc.entries()).toHaveLength(1);
    expect(svc.entries()[0].label).toBe('first');
    expect(svc.entries()[0].snapshot).toEqual([snap('a')]);
  });

  test('push dedupes against the top entry', () => {
    world.setCurrent([snap('a')]);
    svc.push('first');
    svc.push('redundant');
    expect(svc.entries()).toHaveLength(1);
  });

  test('cap evicts the oldest entry', () => {
    const small = new SceneHistoryService(world, { cap: 3 });
    for (let i = 0; i < 5; i++) {
      world.setCurrent([snap('e' + i)]);
      small.push('label-' + i);
    }
    expect(small.entries()).toHaveLength(3);
    expect(small.entries().map(e => e.label)).toEqual(['label-2', 'label-3', 'label-4']);
  });

  test('any new push clears the redo stack', () => {
    world.setCurrent([snap('a')]); svc.push('a');
    world.setCurrent([snap('b')]); svc.push('b');
    // Move one entry from undo to redo (simulating an undo via direct
    // restore + redo manipulation isn't exposed; cover the dedupe-clears-redo
    // semantics directly).
    (svc as any).redoStack_ = [{ snapshot: [], thumbnail: null, label: 'r', timestamp: 0 }];
    world.setCurrent([snap('c')]);
    svc.push('c');
    expect(svc.redoEntries()).toHaveLength(0);
  });

  test('setLastLoaded clears both undo and redo stacks', () => {
    world.setCurrent([snap('a')]); svc.push('a');
    world.setCurrent([snap('b')]); svc.push('b');
    svc.setLastLoaded(SAMPLE_LOAD);
    expect(svc.entries()).toHaveLength(0);
    expect(svc.redoEntries()).toHaveLength(0);
  });

  test('revert clears both undo and redo stacks', () => {
    svc.setLastLoaded(SAMPLE_LOAD);
    world.setCurrent([snap('a')]); svc.push('a');
    world.setCurrent([snap('b')]); svc.push('b');
    svc.revert();
    expect(svc.entries()).toHaveLength(0);
    expect(svc.redoEntries()).toHaveLength(0);
  });

  test('restore delegates to World.replaceScene', () => {
    const entry = {
      snapshot: [snap('x')],
      thumbnail: null,
      label: 'x',
      timestamp: 0,
    };
    svc.restore(entry);
    expect(world.calls).toEqual([[snap('x')]]);
  });

  test('captureThumb is invoked once per push', () => {
    let captures = 0;
    const captured = new SceneHistoryService(world, {
      captureThumb: () => { captures++; return 'data:image/png;base64,iVBOR'; },
    });
    world.setCurrent([snap('a')]); captured.push('a');
    world.setCurrent([snap('b')]); captured.push('b');
    expect(captures).toBe(2);
    expect(captured.entries()[0].thumbnail).toBe('data:image/png;base64,iVBOR');
  });
});
