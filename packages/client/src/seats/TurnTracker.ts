// Pure reducer for player turn tracking. No dependencies on React, sockets,
// three.js, or RoomStateManager — all "what happens next" logic for turns
// lives here so it can be unit-tested in isolation. See planning/prd--turn-order.md.

import { type SeatIndex } from './SeatLayout';
import { SEAT_COUNT } from './RoomState';

export type EndedBy = 'player' | 'host' | 'script';

export interface TurnState {
  enabled:    boolean;
  order:      SeatIndex[];
  activeSeat: SeatIndex | null;
  turnNumber: number;
  // Position in `order` of the active turn. -1 means "off-order" — used when
  // setOrder runs mid-turn, setActive jumps to a seat not in order, or before
  // the first turn. The off-order rule fires from this value: next() wraps to
  // order[0] when orderIndex is -1.
  orderIndex: number;
}

export type TurnAction =
  | { kind: 'enable';    order?: SeatIndex[] }
  | { kind: 'disable';   endedBy?: EndedBy }
  | { kind: 'next';      endedBy?: EndedBy }
  | { kind: 'setActive'; seat: SeatIndex; endedBy?: EndedBy }
  | { kind: 'setOrder';  order: SeatIndex[] };

export type TurnEvent =
  | { kind: 'turn-start'; seat: SeatIndex; turnNumber: number }
  | { kind: 'turn-end';   seat: SeatIndex; turnNumber: number; endedBy: EndedBy };

export interface TurnReducerResult {
  nextState: TurnState;
  events:    TurnEvent[];
}

// Per-dispatch view of seat occupancy. Indexed by seat — true iff that seat
// has a peer sitting in it. The reducer never closes over external state; the
// caller supplies a fresh snapshot for every action.
export type SeatsSnapshot = ReadonlyArray<boolean>;

export const DEFAULT_ORDER: SeatIndex[] = Array.from(
  { length: SEAT_COUNT },
  (_, i) => i as SeatIndex,
);

export function initialTurnState(): TurnState {
  return {
    enabled:    false,
    order:      [...DEFAULT_ORDER],
    activeSeat: null,
    turnNumber: 0,
    orderIndex: -1,
  };
}

export function reduce(
  state: TurnState,
  action: TurnAction,
  seats: SeatsSnapshot,
): TurnReducerResult {
  switch (action.kind) {
    case 'enable':    return enable(action.order, seats);
    case 'disable':   return disable(state, action.endedBy ?? 'script');
    case 'next':      return next(state, seats, action.endedBy ?? 'script');
    case 'setActive': return setActive(state, action.seat, action.endedBy ?? 'script');
    case 'setOrder':  return setOrder(state, action.order);
  }
}

function enable(
  order: SeatIndex[] | undefined,
  seats: SeatsSnapshot,
): TurnReducerResult {
  const nextOrder = order ? [...order] : [...DEFAULT_ORDER];
  const idx = pickFirstOccupiedIndex(nextOrder, seats);
  if (idx === -1) {
    return {
      nextState: {
        enabled:    true,
        order:      nextOrder,
        activeSeat: null,
        turnNumber: 0,
        orderIndex: -1,
      },
      events: [],
    };
  }
  const seat       = nextOrder[idx];
  const turnNumber = 1;
  return {
    nextState: {
      enabled:    true,
      order:      nextOrder,
      activeSeat: seat,
      turnNumber,
      orderIndex: idx,
    },
    events: [{ kind: 'turn-start', seat, turnNumber }],
  };
}

function disable(state: TurnState, endedBy: EndedBy): TurnReducerResult {
  if (!state.enabled) return { nextState: state, events: [] };
  const events: TurnEvent[] = [];
  if (state.activeSeat !== null) {
    events.push({
      kind:       'turn-end',
      seat:       state.activeSeat,
      turnNumber: state.turnNumber,
      endedBy,
    });
  }
  return {
    nextState: {
      enabled:    false,
      order:      state.order,
      activeSeat: null,
      turnNumber: 0,
      orderIndex: -1,
    },
    events,
  };
}

function next(
  state: TurnState,
  seats: SeatsSnapshot,
  endedBy: EndedBy,
): TurnReducerResult {
  if (!state.enabled) return { nextState: state, events: [] };

  const events: TurnEvent[] = [];
  if (state.activeSeat !== null) {
    events.push({
      kind:       'turn-end',
      seat:       state.activeSeat,
      turnNumber: state.turnNumber,
      endedBy,
    });
  }

  const found = pickNextIndex(state.order, state.orderIndex, seats);
  if (found === -1) {
    return {
      nextState: { ...state, activeSeat: null },
      events,
    };
  }

  const seat       = state.order[found];
  const turnNumber = state.turnNumber + 1;
  events.push({ kind: 'turn-start', seat, turnNumber });
  return {
    nextState: { ...state, activeSeat: seat, turnNumber, orderIndex: found },
    events,
  };
}

function setActive(
  state: TurnState,
  seat: SeatIndex,
  endedBy: EndedBy,
): TurnReducerResult {
  if (!state.enabled) return { nextState: state, events: [] };
  if (state.activeSeat === seat) return { nextState: state, events: [] };

  const events: TurnEvent[] = [];
  if (state.activeSeat !== null) {
    events.push({
      kind:       'turn-end',
      seat:       state.activeSeat,
      turnNumber: state.turnNumber,
      endedBy,
    });
  }
  const turnNumber = state.turnNumber + 1;
  // Find first occurrence of seat in order so subsequent next() advances
  // from there. -1 if seat isn't in order — next() then wraps to order[0]
  // per the off-order rule.
  const orderIndex = state.order.indexOf(seat);
  events.push({ kind: 'turn-start', seat, turnNumber });
  return {
    nextState: { ...state, activeSeat: seat, turnNumber, orderIndex },
    events,
  };
}

// setOrder is silent. activeSeat stays where it is; orderIndex is forced to
// -1 so the next next() wraps to order[0]. This implements the off-order rule
// from the PRD even when the new order still contains activeSeat.
function setOrder(state: TurnState, order: SeatIndex[]): TurnReducerResult {
  return {
    nextState: { ...state, order: [...order], orderIndex: -1 },
    events:    [],
  };
}

// Returns the index in `order` of the first occupied seat, or -1.
function pickFirstOccupiedIndex(
  order: ReadonlyArray<SeatIndex>,
  seats: SeatsSnapshot,
): number {
  for (let i = 0; i < order.length; i++) {
    if (isOccupied(order[i], seats)) return i;
  }
  return -1;
}

// Scans `order` starting from the position AFTER `fromIndex` (with wrap).
// When `fromIndex === -1` (off-order or idle), scans from position 0.
// Returns the first index whose seat is occupied, or -1 if none match.
function pickNextIndex(
  order: ReadonlyArray<SeatIndex>,
  fromIndex: number,
  seats: SeatsSnapshot,
): number {
  if (order.length === 0) return -1;
  const start = fromIndex === -1 ? 0 : (fromIndex + 1) % order.length;
  for (let i = 0; i < order.length; i++) {
    const idx = (start + i) % order.length;
    if (isOccupied(order[idx], seats)) return idx;
  }
  return -1;
}

function isOccupied(seat: SeatIndex, seats: SeatsSnapshot): boolean {
  if (seat < 0 || seat >= seats.length) return false;
  return seats[seat] === true;
}

// Build a SeatsSnapshot from a list of occupied seat indices. Callers can use
// this instead of constructing the full 8-slot boolean array inline.
export function makeSeatsSnapshot(occupiedSeats: ReadonlyArray<SeatIndex>): SeatsSnapshot {
  const arr = new Array(SEAT_COUNT).fill(false) as boolean[];
  for (const s of occupiedSeats) {
    if (s >= 0 && s < SEAT_COUNT) arr[s] = true;
  }
  return arr;
}
