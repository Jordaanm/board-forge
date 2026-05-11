// Behavioural tests around the RoomStateManager <-> TurnTracker integration.
// The pure-reducer cases live in TurnTracker.test.ts; this file covers the
// manager's responsibilities: snapshot/patch composition, event fan-out, the
// end-turn-request authority check, and hydrate.

import { describe, test, expect } from 'vitest';
import { RoomStateManager } from './RoomStateManager';
import { type TurnEvent } from './TurnTracker';

const HOST = 'host-peer';

describe('RoomStateManager.dispatchTurnAction', () => {
  test('snapshot includes turn state defaulting to disabled', () => {
    const m = new RoomStateManager(HOST);
    const turns = m.snapshot().turns;
    expect(turns.enabled).toBe(false);
    expect(turns.activeSeat).toBeNull();
    expect(turns.turnNumber).toBe(0);
    expect(turns.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('enable picks first occupied seat and fires turn-start', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');  // → seat 1
    const events: TurnEvent[] = [];
    m.onTurnEvent((e) => events.push(e));
    m.dispatchTurnAction({ kind: 'enable' });
    expect(m.snapshot().turns.activeSeat).toBe(0);
    expect(events).toEqual([{ kind: 'turn-start', seat: 0, turnNumber: 1 }]);
  });

  test('emits a room-state-patch with turns when state changes', () => {
    const m = new RoomStateManager(HOST);
    const patches: unknown[] = [];
    m.onChange((c) => patches.push(c.patch));
    m.dispatchTurnAction({ kind: 'enable' });
    const last = patches[patches.length - 1] as { turns?: unknown };
    expect(last.turns).toBeDefined();
  });

  test('next skips empty seats and fires turn-end then turn-start', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');  // seat 1
    m.assignOnJoin('p2');  // seat 2
    m.removePeer('p1');    // seat 1 free
    const events: TurnEvent[] = [];
    m.onTurnEvent((e) => events.push(e));
    m.dispatchTurnAction({ kind: 'enable' });          // → seat 0
    m.dispatchTurnAction({ kind: 'next', endedBy: 'host' }); // → seat 2 (skip 1)
    expect(events).toEqual([
      { kind: 'turn-start', seat: 0, turnNumber: 1 },
      { kind: 'turn-end',   seat: 0, turnNumber: 1, endedBy: 'host' },
      { kind: 'turn-start', seat: 2, turnNumber: 2 },
    ]);
  });

  test('mid-turn vacancy leaves activeSeat alone and fires no events', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');  // seat 1
    m.dispatchTurnAction({ kind: 'enable' });
    expect(m.snapshot().turns.activeSeat).toBe(0);
    const events: TurnEvent[] = [];
    m.onTurnEvent((e) => events.push(e));
    m.removePeer(HOST);  // active seat now vacant
    expect(events).toEqual([]);
    expect(m.snapshot().turns.activeSeat).toBe(0);
  });
});

describe('RoomStateManager.endTurnRequest', () => {
  test('routes the active seat\'s end-turn to next() with endedBy=player', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');  // seat 1
    m.dispatchTurnAction({ kind: 'enable' });  // active=seat 0=HOST
    // Reseat: host moves out, p1 takes seat 0 — but easier: just have HOST
    // be the active player. The host *is* a peer; endTurnRequest works for
    // them too.
    const events: TurnEvent[] = [];
    m.onTurnEvent((e) => events.push(e));
    const accepted = m.endTurnRequest(HOST);
    expect(accepted).toBe(true);
    expect(events.some(e => e.kind === 'turn-end' && e.endedBy === 'player')).toBe(true);
  });

  test('refuses a peer who is not the active player', () => {
    const m = new RoomStateManager(HOST);
    m.assignOnJoin('p1');  // seat 1
    m.dispatchTurnAction({ kind: 'enable' });  // active = seat 0 (HOST)
    const accepted = m.endTurnRequest('p1');
    expect(accepted).toBe(false);
    expect(m.snapshot().turns.activeSeat).toBe(0);
  });

  test('refuses when turn tracking is disabled', () => {
    const m = new RoomStateManager(HOST);
    expect(m.endTurnRequest(HOST)).toBe(false);
  });
});

describe('RoomStateManager.hydrateTurns', () => {
  test('replaces turn state silently (no events) and emits patch', () => {
    const m = new RoomStateManager(HOST);
    const events: TurnEvent[] = [];
    m.onTurnEvent((e) => events.push(e));
    const patches: unknown[] = [];
    m.onChange((c) => patches.push(c.patch));
    m.hydrateTurns({
      enabled:    true,
      order:      [2, 0, 1] as never,
      activeSeat: 2 as never,
      turnNumber: 7,
      orderIndex: 0,
    });
    expect(events).toEqual([]);                  // silent
    expect(m.snapshot().turns.activeSeat).toBe(2);
    expect(m.snapshot().turns.turnNumber).toBe(7);
    expect(patches).toHaveLength(1);             // patch fires for replication
  });
});
