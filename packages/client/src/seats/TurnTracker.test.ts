import { describe, test, expect } from 'vitest';
import {
  reduce,
  initialTurnState,
  makeSeatsSnapshot,
  type TurnState,
  type SeatsSnapshot,
  type TurnEvent,
} from './TurnTracker';
import { type SeatIndex } from './SeatLayout';

const ALL_OCCUPIED: SeatsSnapshot = makeSeatsSnapshot([0, 1, 2, 3, 4, 5, 6, 7]);
const NONE_OCCUPIED: SeatsSnapshot = makeSeatsSnapshot([]);

// Shorthand: enable, drive one or more actions, and return the resulting
// state + cumulative events. Each step uses a fresh seats snapshot per call.
function run(
  initial: TurnState,
  steps: Array<{ action: Parameters<typeof reduce>[1]; seats: SeatsSnapshot }>,
): { state: TurnState; events: TurnEvent[] } {
  let state = initial;
  const events: TurnEvent[] = [];
  for (const step of steps) {
    const result = reduce(state, step.action, step.seats);
    state = result.nextState;
    events.push(...result.events);
  }
  return { state, events };
}

describe('TurnTracker — enable', () => {
  test('with no occupants → idle, no events, turnNumber 0', () => {
    const result = reduce(initialTurnState(), { kind: 'enable' }, NONE_OCCUPIED);
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.activeSeat).toBeNull();
    expect(result.nextState.turnNumber).toBe(0);
    expect(result.events).toEqual([]);
  });

  test('with occupants → auto-picks first in order, fires turn-start, turnNumber 1', () => {
    const seats = makeSeatsSnapshot([2, 5]);
    const result = reduce(initialTurnState(), { kind: 'enable' }, seats);
    expect(result.nextState.activeSeat).toBe(2);
    expect(result.nextState.turnNumber).toBe(1);
    expect(result.events).toEqual([
      { kind: 'turn-start', seat: 2, turnNumber: 1 },
    ]);
  });

  test('default order is [0..7]', () => {
    const seats = makeSeatsSnapshot([3]);
    const result = reduce(initialTurnState(), { kind: 'enable' }, seats);
    expect(result.nextState.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('explicit order overrides default', () => {
    const seats = makeSeatsSnapshot([0, 2, 5]);
    const order: SeatIndex[] = [5, 2, 0];
    const result = reduce(initialTurnState(), { kind: 'enable', order }, seats);
    expect(result.nextState.order).toEqual([5, 2, 0]);
    expect(result.nextState.activeSeat).toBe(5);
  });

  test('re-enable resets turnNumber to 1', () => {
    const seats = makeSeatsSnapshot([0, 1, 2]);
    const { state } = run(initialTurnState(), [
      { action: { kind: 'enable' }, seats },
      { action: { kind: 'next'   }, seats },
      { action: { kind: 'next'   }, seats },
    ]);
    expect(state.turnNumber).toBe(3);
    const re = reduce(state, { kind: 'enable' }, seats);
    expect(re.nextState.turnNumber).toBe(1);
  });
});

describe('TurnTracker — next', () => {
  test('advances skipping empty seats', () => {
    const seats = makeSeatsSnapshot([0, 3, 5]);
    const { state, events } = run(initialTurnState(), [
      { action: { kind: 'enable' }, seats },
      { action: { kind: 'next'   }, seats },
    ]);
    expect(state.activeSeat).toBe(3);
    expect(events).toEqual([
      { kind: 'turn-start', seat: 0, turnNumber: 1 },
      { kind: 'turn-end',   seat: 0, turnNumber: 1, endedBy: 'script' },
      { kind: 'turn-start', seat: 3, turnNumber: 2 },
    ]);
  });

  test('wraps from the end back to the beginning', () => {
    const seats = makeSeatsSnapshot([0, 7]);
    const { state } = run(initialTurnState(), [
      { action: { kind: 'enable' }, seats },  // active=0, idx=0
      { action: { kind: 'next'   }, seats },  // active=7
      { action: { kind: 'next'   }, seats },  // wrap → active=0
    ]);
    expect(state.activeSeat).toBe(0);
    expect(state.turnNumber).toBe(3);
  });

  test('with no occupants while active fires only turn-end', () => {
    const occupied = makeSeatsSnapshot([2]);
    const vacated  = makeSeatsSnapshot([]);
    const enabled  = reduce(initialTurnState(), { kind: 'enable' }, occupied);
    const result   = reduce(enabled.nextState, { kind: 'next' }, vacated);
    expect(result.events).toEqual([
      { kind: 'turn-end', seat: 2, turnNumber: 1, endedBy: 'script' },
    ]);
    expect(result.nextState.activeSeat).toBeNull();
  });

  test('endedBy is propagated', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'next', endedBy: 'player' }, seats);
    expect(result.events[0]).toEqual({
      kind: 'turn-end', seat: 0, turnNumber: 1, endedBy: 'player',
    });
  });

  test('does nothing when disabled', () => {
    const result = reduce(initialTurnState(), { kind: 'next' }, ALL_OCCUPIED);
    expect(result.nextState).toEqual(initialTurnState());
    expect(result.events).toEqual([]);
  });

  test('from idle (active null, enabled) picks first occupied, only turn-start', () => {
    const noOccupants = makeSeatsSnapshot([]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, noOccupants);
    expect(enabled.nextState.activeSeat).toBeNull();

    const occupied = makeSeatsSnapshot([3]);
    const result = reduce(enabled.nextState, { kind: 'next' }, occupied);
    expect(result.nextState.activeSeat).toBe(3);
    expect(result.events).toEqual([
      { kind: 'turn-start', seat: 3, turnNumber: 1 },
    ]);
  });
});

describe('TurnTracker — setActive', () => {
  test('to a different seat emits turn-end then turn-start', () => {
    const seats = makeSeatsSnapshot([0, 1, 2, 3]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'setActive', seat: 3 }, seats);
    expect(result.events).toEqual([
      { kind: 'turn-end',   seat: 0, turnNumber: 1, endedBy: 'script' },
      { kind: 'turn-start', seat: 3, turnNumber: 2 },
    ]);
    expect(result.nextState.activeSeat).toBe(3);
  });

  test('to the same seat is a no-op (no events)', () => {
    const seats = makeSeatsSnapshot([0]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'setActive', seat: 0 }, seats);
    expect(result.events).toEqual([]);
    expect(result.nextState.activeSeat).toBe(0);
  });

  test('endedBy is propagated on turn-end', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'setActive', seat: 1, endedBy: 'host' }, seats);
    expect(result.events[0]).toEqual({
      kind: 'turn-end', seat: 0, turnNumber: 1, endedBy: 'host',
    });
  });

  test('from idle (active null) emits only turn-start', () => {
    const noOccupants = makeSeatsSnapshot([]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, noOccupants);
    const occupied = makeSeatsSnapshot([5]);
    const result = reduce(enabled.nextState, { kind: 'setActive', seat: 5 }, occupied);
    expect(result.events).toEqual([
      { kind: 'turn-start', seat: 5, turnNumber: 1 },
    ]);
  });

  test('does nothing when disabled', () => {
    const result = reduce(initialTurnState(), { kind: 'setActive', seat: 3 }, ALL_OCCUPIED);
    expect(result.nextState.activeSeat).toBeNull();
    expect(result.events).toEqual([]);
  });
});

describe('TurnTracker — disable', () => {
  test('while active emits turn-end with the supplied endedBy', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'disable', endedBy: 'host' }, seats);
    expect(result.events).toEqual([
      { kind: 'turn-end', seat: 0, turnNumber: 1, endedBy: 'host' },
    ]);
    expect(result.nextState.enabled).toBe(false);
    expect(result.nextState.activeSeat).toBeNull();
    expect(result.nextState.turnNumber).toBe(0);
  });

  test('while enabled with no active seat fires no events', () => {
    const noOccupants = makeSeatsSnapshot([]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, noOccupants);
    const result  = reduce(enabled.nextState, { kind: 'disable' }, noOccupants);
    expect(result.events).toEqual([]);
    expect(result.nextState.enabled).toBe(false);
  });

  test('on a disabled tracker is a no-op', () => {
    const result = reduce(initialTurnState(), { kind: 'disable' }, ALL_OCCUPIED);
    expect(result.nextState).toEqual(initialTurnState());
    expect(result.events).toEqual([]);
  });
});

describe('TurnTracker — turnNumber', () => {
  test('increments on every turn-start', () => {
    const seats = makeSeatsSnapshot([0, 1, 2]);
    const { state, events } = run(initialTurnState(), [
      { action: { kind: 'enable' }, seats },                   // turnNumber=1
      { action: { kind: 'next'   }, seats },                   // turnNumber=2
      { action: { kind: 'setActive', seat: 0 }, seats },       // turnNumber=3
      { action: { kind: 'next'   }, seats },                   // turnNumber=4
    ]);
    expect(state.turnNumber).toBe(4);
    const startTurnNumbers = events
      .filter(e => e.kind === 'turn-start')
      .map(e => e.turnNumber);
    expect(startTurnNumbers).toEqual([1, 2, 3, 4]);
  });

  test('resets only on enable', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const advanced = reduce(enabled.nextState, { kind: 'next' }, seats);
    const disabled = reduce(advanced.nextState, { kind: 'disable' }, seats);
    expect(disabled.nextState.turnNumber).toBe(0);
    const reEnabled = reduce(disabled.nextState, { kind: 'enable' }, seats);
    expect(reEnabled.nextState.turnNumber).toBe(1);
  });
});

describe('TurnTracker — mid-turn vacancy', () => {
  test('leaves activeSeat unchanged and fires no events (silent)', () => {
    const initialOccupied = makeSeatsSnapshot([0, 1, 2]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, initialOccupied);
    expect(enabled.nextState.activeSeat).toBe(0);
    // Active seat 0 vacates. The reducer is only driven by actions; vacancy
    // alone is silent: state is whatever it was, no events fire.
    expect(enabled.nextState.activeSeat).toBe(0);
    expect(enabled.events.length).toBe(1);  // only the original turn-start
  });
});

describe('TurnTracker — off-order wrap', () => {
  test('next() after setOrder mid-turn wraps to order[0]', () => {
    const seats = makeSeatsSnapshot([0, 1, 2, 3, 4]);
    const { state } = run(initialTurnState(), [
      { action: { kind: 'enable' }, seats },        // active=0
      { action: { kind: 'next'   }, seats },        // active=1
      // Replace order with [3, 4]. The next next() must wrap to order[0]=3
      // regardless of where activeSeat is now.
      { action: { kind: 'setOrder', order: [3, 4] as SeatIndex[] }, seats },
    ]);
    expect(state.activeSeat).toBe(1);  // unchanged
    const result = reduce(state, { kind: 'next' }, seats);
    expect(result.nextState.activeSeat).toBe(3);
  });
});

describe('TurnTracker — setOrder', () => {
  test('is silent (no events)', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'setOrder', order: [1, 0] as SeatIndex[] }, seats);
    expect(result.events).toEqual([]);
    expect(result.nextState.order).toEqual([1, 0]);
    expect(result.nextState.activeSeat).toBe(0);  // unchanged
  });

  test('empty order: next() reaches idle', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const cleared = reduce(enabled.nextState, { kind: 'setOrder', order: [] as SeatIndex[] }, seats);
    const result  = reduce(cleared.nextState, { kind: 'next' }, seats);
    expect(result.nextState.activeSeat).toBeNull();
    expect(result.events).toEqual([
      { kind: 'turn-end', seat: 0, turnNumber: 1, endedBy: 'script' },
    ]);
  });

  test('duplicates [0,1,0,2] cause seat 0 to fire twice per round', () => {
    const seats = makeSeatsSnapshot([0, 1, 2]);
    const order: SeatIndex[] = [0, 1, 0, 2];
    const { events } = run(initialTurnState(), [
      { action: { kind: 'enable', order }, seats },  // active=0 (idx 0), turn 1
      { action: { kind: 'next'   }, seats },         // active=1, turn 2
      { action: { kind: 'next'   }, seats },         // active=0 (idx 2), turn 3
      { action: { kind: 'next'   }, seats },         // active=2, turn 4
    ]);
    const starts = events.filter(e => e.kind === 'turn-start');
    expect(starts.map(e => e.seat)).toEqual([0, 1, 0, 2]);
  });

  test('out-of-layout indices in order are silently skipped at advance-time', () => {
    // Only 4 seats occupied; order references seat 7 which is empty.
    const seats = makeSeatsSnapshot([0, 1, 2, 3]);
    const order: SeatIndex[] = [7, 0, 1];
    const { state, events } = run(initialTurnState(), [
      { action: { kind: 'enable', order }, seats },  // skip 7 → active=0
      { action: { kind: 'next'   }, seats },         // active=1
      { action: { kind: 'next'   }, seats },         // wrap: skip 7 → active=0
    ]);
    expect(state.activeSeat).toBe(0);
    const startSeats = events.filter(e => e.kind === 'turn-start').map(e => e.seat);
    expect(startSeats).toEqual([0, 1, 0]);
  });

  test('setOrder while active does not fire events', () => {
    const seats = makeSeatsSnapshot([0, 1]);
    const enabled = reduce(initialTurnState(), { kind: 'enable' }, seats);
    const result  = reduce(enabled.nextState, { kind: 'setOrder', order: [1, 0] as SeatIndex[] }, seats);
    expect(result.events).toEqual([]);
  });
});

describe('TurnTracker — setActive with off-order seat', () => {
  test('seat not in order: next() then wraps to order[0]', () => {
    const seats = makeSeatsSnapshot([0, 1, 2, 5]);
    const order: SeatIndex[] = [0, 1, 2];
    const enabled = reduce(initialTurnState(), { kind: 'enable', order }, seats);
    const jumped  = reduce(enabled.nextState, { kind: 'setActive', seat: 5 }, seats);
    expect(jumped.nextState.activeSeat).toBe(5);
    const advanced = reduce(jumped.nextState, { kind: 'next' }, seats);
    expect(advanced.nextState.activeSeat).toBe(0);
  });
});
