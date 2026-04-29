import { describe, test, expect } from 'vitest';
import { canManipulate } from './OwnershipPolicy';
import { type SeatIndex } from './SeatLayout';

type Case = [SeatIndex | null, boolean, SeatIndex | null, boolean];

// Twelve-case matrix from planning/issues/issues--seats-mvp.md (slice #4).
//   9 guest cases: peerSeat ∈ {null, 0, 1} × entityOwner ∈ {null, 0, 1}
//   3 host  cases: peerSeat = 0, isHost = true,  entityOwner ∈ {null, 0, 1}
//
// Columns: peerSeat | isHost | entityOwner | expected
const CASES: Case[] = [
  // Spectator — never may manipulate.
  [null, false, null, false],
  [null, false, 0,    false],
  [null, false, 1,    false],

  // Seated peer 0 — may manipulate unowned and own; not others'.
  [0,    false, null, true ],
  [0,    false, 0,    true ],
  [0,    false, 1,    false],

  // Seated peer 1 — symmetric.
  [1,    false, null, true ],
  [1,    false, 0,    false],
  [1,    false, 1,    true ],

  // Host — always may manipulate.
  [0,    true,  null, true ],
  [0,    true,  0,    true ],
  [0,    true,  1,    true ],
];

describe('canManipulate', () => {
  test('matrix has 12 cases', () => {
    expect(CASES).toHaveLength(12);
  });

  test.each(CASES)(
    'peerSeat=%s isHost=%s entityOwner=%s → %s',
    (peerSeat, isHost, entityOwner, expected) => {
      expect(canManipulate({ peerSeat, isHost }, entityOwner)).toBe(expected);
    },
  );
});
