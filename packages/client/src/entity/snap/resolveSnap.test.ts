import { describe, test, expect } from 'vitest';
import { resolveSnap, type SnapCandidate, type SnapInput } from './resolveSnap';

function candidate(over: Partial<SnapCandidate>): SnapCandidate {
  return {
    ownerEntityId: 'marker',
    worldPos:      [0, 0, 0],
    worldYaw:      0,
    snapRotation:  false,
    radius:        1,
    ...over,
  };
}

function input(over: Partial<SnapInput>): SnapInput {
  return {
    droppedXZ:       [0, 0],
    droppedEntityId: 'card',
    descendantIds:   new Set<string>(),
    candidates:      [],
    ...over,
  };
}

describe('resolveSnap', () => {
  test('no candidates → null', () => {
    expect(resolveSnap(input({}))).toBeNull();
  });

  test('single candidate inside radius → wins; fields match candidate', () => {
    const c = candidate({ worldPos: [0.1, 2, 0.1], worldYaw: 1.23, snapRotation: true, radius: 1 });
    const r = resolveSnap(input({ candidates: [c] }));
    expect(r).toEqual({ targetPos: [0.1, 2, 0.1], targetYaw: 1.23, snapRotation: true });
  });

  test('single candidate outside radius → null', () => {
    const c = candidate({ worldPos: [5, 0, 0], radius: 1 });
    expect(resolveSnap(input({ candidates: [c] }))).toBeNull();
  });

  test('multiple candidates inside radius → closest XZ wins', () => {
    const near = candidate({ ownerEntityId: 'near', worldPos: [0.1, 0, 0.1], radius: 2 });
    const far  = candidate({ ownerEntityId: 'far',  worldPos: [1.0, 0, 0.0], radius: 2 });
    const r = resolveSnap(input({ candidates: [far, near] }));
    expect(r?.targetPos).toEqual([0.1, 0, 0.1]);
  });

  test('tied distances → first in input order wins (deterministic)', () => {
    const a = candidate({ ownerEntityId: 'a', worldPos: [0.5, 0, 0], radius: 1 });
    const b = candidate({ ownerEntityId: 'b', worldPos: [-0.5, 0, 0], radius: 1 });
    const r = resolveSnap(input({ candidates: [a, b] }));
    expect(r?.targetPos).toEqual([0.5, 0, 0]);

    const r2 = resolveSnap(input({ candidates: [b, a] }));
    expect(r2?.targetPos).toEqual([-0.5, 0, 0]);
  });

  test('candidate owned by droppedEntityId is excluded', () => {
    const self  = candidate({ ownerEntityId: 'card', worldPos: [0, 0, 0], radius: 1 });
    const other = candidate({ ownerEntityId: 'm',    worldPos: [0.5, 0, 0], radius: 1 });
    const r = resolveSnap(input({ droppedEntityId: 'card', candidates: [self, other] }));
    expect(r?.targetPos).toEqual([0.5, 0, 0]);
  });

  test('candidate owned by an entity in descendantIds is excluded', () => {
    const child = candidate({ ownerEntityId: 'child', worldPos: [0, 0, 0], radius: 1 });
    const other = candidate({ ownerEntityId: 'm',     worldPos: [0.5, 0, 0], radius: 1 });
    const r = resolveSnap(input({
      droppedEntityId: 'parent',
      descendantIds:   new Set(['child']),
      candidates:      [child, other],
    }));
    expect(r?.targetPos).toEqual([0.5, 0, 0]);
  });

  test('XZ-only: large Y delta but small XZ delta is still a hit', () => {
    const c = candidate({ worldPos: [0, 1000, 0], radius: 0.5 });
    const r = resolveSnap(input({ droppedXZ: [0, 0], candidates: [c] }));
    expect(r).not.toBeNull();
    expect(r!.targetPos[1]).toBe(1000);
  });

  test('XZ-only: small Y delta but XZ outside radius is a miss', () => {
    const c = candidate({ worldPos: [5, 0.01, 0], radius: 1 });
    const r = resolveSnap(input({ droppedXZ: [0, 0], candidates: [c] }));
    expect(r).toBeNull();
  });

  test('snapRotation flag passes through unchanged (true)', () => {
    const c = candidate({ snapRotation: true });
    const r = resolveSnap(input({ candidates: [c] }));
    expect(r?.snapRotation).toBe(true);
  });

  test('snapRotation flag passes through unchanged (false)', () => {
    const c = candidate({ snapRotation: false });
    const r = resolveSnap(input({ candidates: [c] }));
    expect(r?.snapRotation).toBe(false);
  });

  test('targetPos.y equals candidate world Y regardless of dropped entity Y', () => {
    // Y of dropped entity isn't part of input; only candidate Y matters.
    const c = candidate({ worldPos: [0, 7.5, 0], radius: 1 });
    const r = resolveSnap(input({ candidates: [c] }));
    expect(r?.targetPos[1]).toBe(7.5);
  });
});
