import { describe, test, expect } from 'vitest';
import { RoomStateManager, type RoomStateChange } from './RoomStateManager';
import { SEAT_COLOURS } from './SeatLayout';

const HOST = 'host-peer';

describe('RoomStateManager — construction', () => {
  test('host is auto-seated at seat 0', () => {
    const m = new RoomStateManager(HOST);
    expect(m.getSeat(HOST)).toBe(0);
  });

  test('snapshot exposes 8 seats with fixed colour order', () => {
    const m = new RoomStateManager(HOST);
    const snap = m.snapshot();
    expect(snap.seats).toHaveLength(8);
    snap.seats.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.colour).toBe(SEAT_COLOURS[i]);
    });
  });

  test('snapshot reports hostPeerId', () => {
    const m = new RoomStateManager(HOST);
    expect(m.snapshot().hostPeerId).toBe(HOST);
  });
});

describe('RoomStateManager — assignOnJoin', () => {
  test('fills lowest empty seat', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    expect(m.getSeat('p1')).toBe(1);
    m.assignOnJoin('p2');
    expect(m.getSeat('p2')).toBe(2);
  });

  test('fills the gap left by a seated peer leaving', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');     // → seat 1
    m.assignOnJoin('p2');     // → seat 2
    m.removePeer('p1');       // frees seat 1
    m.assignOnJoin('p3');
    expect(m.getSeat('p3')).toBe(1);
  });

  test('re-assigning an already-seated peer is a no-op', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    const before = m.snapshot();
    m.assignOnJoin('p1');
    expect(m.snapshot()).toEqual(before);
  });

  test('falls back to spectator once 8 seats are occupied', () => {
    const m = new RoomStateManager(HOST);
    for (let i = 1; i <= 7; i++) m.assignOnJoin(`p${i}`);
    expect(m.getSeatedPeers()).toHaveLength(8);
    m.assignOnJoin('overflow');
    expect(m.getSeat('overflow')).toBeNull();
    expect(m.snapshot().spectators).toContain('overflow');
  });

  test('multiple spectators stack in arrival order', () => {
    const m = new RoomStateManager(HOST);
    for (let i = 1; i <= 7; i++) m.assignOnJoin(`p${i}`);
    m.assignOnJoin('s1');
    m.assignOnJoin('s2');
    expect(m.snapshot().spectators).toEqual(['s1', 's2']);
  });
});

describe('RoomStateManager — removePeer', () => {
  test('frees a seated peer\'s seat', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    m.removePeer('p1');
    expect(m.getSeat('p1')).toBeNull();
    expect(m.snapshot().seats[1].peerId).toBeNull();
  });

  test('removes a spectator from the list', () => {
    const m = new RoomStateManager(HOST);
    for (let i = 1; i <= 7; i++) m.assignOnJoin(`p${i}`);
    m.assignOnJoin('spec');
    m.removePeer('spec');
    expect(m.snapshot().spectators).not.toContain('spec');
  });

  test('removing an unknown peer is a no-op', () => {
    const m = new RoomStateManager(HOST);
    const before = m.snapshot();
    m.removePeer('ghost');
    expect(m.snapshot()).toEqual(before);
  });

  test('host can be removed (room dies elsewhere; manager just tracks state)', () => {
    const m = new RoomStateManager(HOST);
    m.removePeer(HOST);
    expect(m.getSeat(HOST)).toBeNull();
  });
});

describe('RoomStateManager — host detection', () => {
  test('isHost is true only for the constructor peer', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    expect(m.isHost(HOST)).toBe(true);
    expect(m.isHost('p1')).toBe(false);
    expect(m.isHost('unknown')).toBe(false);
  });
});

describe('RoomStateManager — getSeatedPeers', () => {
  test('returns ascending seat order', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    m.assignOnJoin('p2');
    m.removePeer('p1');
    m.assignOnJoin('p3');     // takes seat 1
    expect(m.getSeatedPeers().map(s => s.seat)).toEqual([0, 1, 2]);
  });

  test('excludes spectators', () => {
    const m = new RoomStateManager(HOST);
    for (let i = 1; i <= 7; i++) m.assignOnJoin(`p${i}`);
    m.assignOnJoin('spec');
    expect(m.getSeatedPeers().map(s => s.peerId)).not.toContain('spec');
  });
});

describe('RoomStateManager — change events', () => {
  function record(m: RoomStateManager): RoomStateChange[] {
    const out: RoomStateChange[] = [];
    m.onChange(c => out.push(c));
    return out;
  }

  test('assignOnJoin emits seat patch', () => {
    const m = new RoomStateManager(HOST);
    const events = record(m);
    m.assignOnJoin('p1');
    expect(events).toHaveLength(1);
    expect(events[0].patch.seats).toEqual([
      { index: 1, colour: SEAT_COLOURS[1], peerId: 'p1' },
    ]);
  });

  test('overflow assignOnJoin emits spectatorsAdded patch', () => {
    const m = new RoomStateManager(HOST);
    for (let i = 1; i <= 7; i++) m.assignOnJoin(`p${i}`);
    const events = record(m);
    m.assignOnJoin('spec');
    expect(events).toHaveLength(1);
    expect(events[0].patch.spectatorsAdded).toEqual(['spec']);
  });

  test('removePeer of a seated peer emits seat patch with peerId null', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    const events = record(m);
    m.removePeer('p1');
    expect(events[0].patch.seats).toEqual([
      { index: 1, colour: SEAT_COLOURS[1], peerId: null },
    ]);
  });

  test('removePeer of a spectator emits spectatorsRemoved patch', () => {
    const m = new RoomStateManager(HOST);
    for (let i = 1; i <= 7; i++) m.assignOnJoin(`p${i}`);
    m.assignOnJoin('spec');
    const events = record(m);
    m.removePeer('spec');
    expect(events[0].patch.spectatorsRemoved).toEqual(['spec']);
  });

  test('no event fires for no-op assignOnJoin', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    const events = record(m);
    m.assignOnJoin('p1');
    expect(events).toHaveLength(0);
  });

  test('no event fires for no-op removePeer', () => {
    const m = new RoomStateManager(HOST);
    const events = record(m);
    m.removePeer('ghost');
    expect(events).toHaveLength(0);
  });

  test('change.snapshot reflects state after the mutation', () => {
    const m = new RoomStateManager(HOST);
    const events = record(m);
    m.assignOnJoin('p1');
    expect(events[0].snapshot.seats[1].peerId).toBe('p1');
  });
});

describe('RoomStateManager — snapshot stability', () => {
  test('two snapshots across a no-op are deep-equal', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');
    const a = m.snapshot();
    m.assignOnJoin('p1');     // no-op (already seated)
    m.removePeer('ghost');    // no-op (unknown peer)
    const b = m.snapshot();
    expect(b).toEqual(a);
  });

  test('snapshot is a defensive copy — mutating it does not affect the manager', () => {
    const m = new RoomStateManager(HOST);
    const a = m.snapshot();
    a.seats[0].peerId = 'tampered';
    a.spectators.push('tampered');
    expect(m.getSeat(HOST)).toBe(0);
    expect(m.snapshot().spectators).toEqual([]);
  });
});
