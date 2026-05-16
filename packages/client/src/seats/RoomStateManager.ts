// Host-authoritative seat manager. Pure state + event emission; no networking.
// See planning/prd--seats-MVP.md.

import { type SeatIndex } from './SeatLayout';
import {
  SEAT_COUNT,
  makeEmptySeats,
  type RoomStatePatch,
  type RoomStateSnapshot,
  type SeatEntry,
} from './RoomState';
import {
  reduce,
  initialTurnState,
  type TurnAction,
  type TurnEvent,
  type TurnState,
  type SeatsSnapshot,
  type EndedBy,
} from './TurnTracker';

export interface SeatedPeer { seat: SeatIndex; peerId: string; }

export interface RoomStateChange {
  patch:    RoomStatePatch;
  snapshot: RoomStateSnapshot;
}

type Listener = (change: RoomStateChange) => void;
type TurnEventListener = (event: TurnEvent) => void;

export class RoomStateManager {
  private readonly hostPeerId: string;
  private readonly seats: SeatEntry[] = makeEmptySeats();
  private readonly spectators: string[] = [];
  private readonly banned: Set<string> = new Set();
  private readonly listeners: Listener[] = [];
  private readonly turnEventListeners: TurnEventListener[] = [];
  private readonly names: Map<string, string> = new Map();
  private turns: TurnState = initialTurnState();

  constructor(hostPeerId: string, hostDisplayName: string = '') {
    this.hostPeerId = hostPeerId;
    this.seats[0].peerId = hostPeerId;
    if (hostDisplayName !== '') this.names.set(hostPeerId, hostDisplayName);
  }

  assignOnJoin(peerId: string, displayName: string = ''): void {
    if (this.banned.has(peerId)) return;
    const nameChanged = displayName !== '' && this.names.get(peerId) !== displayName;
    if (nameChanged) this.names.set(peerId, displayName);
    const namesPatch = nameChanged ? { [peerId]: displayName } : undefined;
    if (this.locate(peerId)) {
      if (namesPatch) this.emit({ names: namesPatch });
      return;
    }

    const empty = this.seats.find(s => s.peerId === null);
    if (empty) {
      empty.peerId = peerId;
      this.emit({ seats: [{ ...empty }], names: namesPatch });
      return;
    }

    this.spectators.push(peerId);
    this.emit({ spectatorsAdded: [peerId], names: namesPatch });
  }

  removePeer(peerId: string): void {
    const hadName = this.names.delete(peerId);
    const namesPatch: Record<string, string | null> | undefined =
      hadName ? { [peerId]: null } : undefined;
    const seated = this.seats.find(s => s.peerId === peerId);
    if (seated) {
      seated.peerId = null;
      this.emit({ seats: [{ ...seated }], names: namesPatch });
      return;
    }

    const idx = this.spectators.indexOf(peerId);
    if (idx === -1) {
      if (namesPatch) this.emit({ names: namesPatch });
      return;
    }
    this.spectators.splice(idx, 1);
    this.emit({ spectatorsRemoved: [peerId], names: namesPatch });
  }

  // Move peerId to seatIndex if it is empty. Returns false if the seat is
  // already occupied or the peer is unknown / banned.
  claimSeat(peerId: string, seatIndex: SeatIndex): boolean {
    if (this.banned.has(peerId))         return false;
    const target = this.seats[seatIndex];
    if (!target || target.peerId !== null) return false;

    const fromSeat = this.seats.find(s => s.peerId === peerId);
    if (fromSeat) {
      fromSeat.peerId = null;
      target.peerId   = peerId;
      this.emit({ seats: [{ ...fromSeat }, { ...target }] });
      return true;
    }

    const specIdx = this.spectators.indexOf(peerId);
    if (specIdx !== -1) {
      this.spectators.splice(specIdx, 1);
      target.peerId = peerId;
      this.emit({ seats: [{ ...target }], spectatorsRemoved: [peerId] });
      return true;
    }

    target.peerId = peerId;
    this.emit({ seats: [{ ...target }] });
    return true;
  }

  banPeer(peerId: string): void {
    this.banned.add(peerId);
    this.removePeer(peerId);
  }

  isBanned(peerId: string): boolean {
    return this.banned.has(peerId);
  }

  getSeat(peerId: string): SeatIndex | null {
    const seat = this.seats.find(s => s.peerId === peerId);
    return seat ? seat.index : null;
  }

  getSeatedPeers(): SeatedPeer[] {
    return this.seats
      .filter(s => s.peerId !== null)
      .map(s => ({ seat: s.index, peerId: s.peerId! }));
  }

  isHost(peerId: string): boolean {
    return peerId === this.hostPeerId;
  }

  snapshot(): RoomStateSnapshot {
    return {
      hostPeerId: this.hostPeerId,
      seats:      this.seats.map(s => ({ ...s })),
      spectators: [...this.spectators],
      turns:      cloneTurns(this.turns),
      names:      Object.fromEntries(this.names),
    };
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  // Subscribers receive a TurnEvent per reducer-emitted event, in order. The
  // Game-hook bridge attaches here.
  onTurnEvent(listener: TurnEventListener): () => void {
    this.turnEventListeners.push(listener);
    return () => {
      const i = this.turnEventListeners.indexOf(listener);
      if (i !== -1) this.turnEventListeners.splice(i, 1);
    };
  }

  // Read-only snapshot of the current turn state.
  getTurns(): TurnState {
    return cloneTurns(this.turns);
  }

  // Host-side mutation entry. Builds the seat snapshot, dispatches the action
  // through the pure reducer, applies the result, then fires events.
  dispatchTurnAction(action: TurnAction): void {
    const snapshot = this.seatsOccupancy();
    const result = reduce(this.turns, action, snapshot);
    const turnsChanged = !sameTurns(this.turns, result.nextState);
    this.turns = result.nextState;
    if (turnsChanged) {
      this.emit({ turns: cloneTurns(this.turns) });
    }
    for (const event of result.events) {
      for (const l of this.turnEventListeners) l(event);
    }
  }

  // Host-only: invoked when a guest sends an `end-turn-request`. Validates
  // the sender holds the active seat, then routes the action through the
  // reducer with endedBy='player'. Out-of-turn requests are silently dropped
  // (host's authoritative state isn't visible to the guest mid-flight).
  endTurnRequest(peerId: string): boolean {
    if (!this.turns.enabled) return false;
    const seat = this.getSeat(peerId);
    if (seat === null) return false;
    if (this.turns.activeSeat !== seat) return false;
    this.dispatchTurnAction({ kind: 'next', endedBy: 'player' });
    return true;
  }

  // Host-only: install a turn-state restored from a save envelope. Silent —
  // does not fire events. Replaces the turn state wholesale and broadcasts a
  // patch so guests mirror the new value.
  hydrateTurns(turns: TurnState): void {
    this.turns = cloneTurns(turns);
    this.emit({ turns: cloneTurns(this.turns) });
  }

  private seatsOccupancy(): SeatsSnapshot {
    return this.seats.map(s => s.peerId !== null);
  }

  private locate(peerId: string): boolean {
    if (this.seats.some(s => s.peerId === peerId)) return true;
    if (this.spectators.includes(peerId)) return true;
    return false;
  }

  private emit(patch: RoomStatePatch): void {
    if (this.listeners.length === 0) return;
    if (
      (!patch.seats || patch.seats.length === 0) &&
      (!patch.spectatorsAdded   || patch.spectatorsAdded.length   === 0) &&
      (!patch.spectatorsRemoved || patch.spectatorsRemoved.length === 0) &&
      !patch.turns &&
      (!patch.names || Object.keys(patch.names).length === 0)
    ) return;

    const change: RoomStateChange = { patch, snapshot: this.snapshot() };
    for (const l of this.listeners) l(change);
  }
}

// Re-export so callers can type the seat count without a separate import.
export { SEAT_COUNT };
export { type EndedBy };

function cloneTurns(t: TurnState): TurnState {
  return {
    enabled:    t.enabled,
    order:      [...t.order],
    activeSeat: t.activeSeat,
    turnNumber: t.turnNumber,
    orderIndex: t.orderIndex,
  };
}

function sameTurns(a: TurnState, b: TurnState): boolean {
  if (a.enabled !== b.enabled) return false;
  if (a.activeSeat !== b.activeSeat) return false;
  if (a.turnNumber !== b.turnNumber) return false;
  if (a.orderIndex !== b.orderIndex) return false;
  if (a.order.length !== b.order.length) return false;
  for (let i = 0; i < a.order.length; i++) {
    if (a.order[i] !== b.order[i]) return false;
  }
  return true;
}
