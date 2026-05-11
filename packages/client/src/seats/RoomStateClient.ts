// Peer-side read-only mirror of host's RoomState.
// See planning/prd--seats-MVP.md.

import { type SeatIndex } from './SeatLayout';
import {
  type RoomStatePatch,
  type RoomStateSnapshot,
} from './RoomState';
import { initialTurnState, type TurnState } from './TurnTracker';

type Listener = (snapshot: RoomStateSnapshot) => void;

export class RoomStateClient {
  private readonly myPeerId: string;
  private currentSnapshot: RoomStateSnapshot | null = null;
  private readonly listeners: Listener[] = [];

  constructor(myPeerId: string) {
    this.myPeerId = myPeerId;
  }

  applySnapshot(snapshot: RoomStateSnapshot): void {
    this.currentSnapshot = {
      hostPeerId: snapshot.hostPeerId,
      seats:      snapshot.seats.map(s => ({ ...s })),
      spectators: [...snapshot.spectators],
      turns:      snapshot.turns ? cloneTurns(snapshot.turns) : initialTurnState(),
    };
    this.emit();
  }

  applyPatch(patch: RoomStatePatch): void {
    if (!this.currentSnapshot) return;

    if (patch.seats) {
      for (const incoming of patch.seats) {
        const existing = this.currentSnapshot.seats.find(s => s.index === incoming.index);
        if (existing) {
          existing.peerId = incoming.peerId;
          existing.colour = incoming.colour;
        }
      }
    }

    if (patch.spectatorsAdded) {
      for (const id of patch.spectatorsAdded) {
        if (!this.currentSnapshot.spectators.includes(id)) this.currentSnapshot.spectators.push(id);
      }
    }

    if (patch.spectatorsRemoved) {
      this.currentSnapshot.spectators = this.currentSnapshot.spectators.filter(
        id => !patch.spectatorsRemoved!.includes(id),
      );
    }

    if (patch.turns) {
      this.currentSnapshot.turns = cloneTurns(patch.turns);
    }

    this.emit();
  }

  snapshot(): RoomStateSnapshot | null {
    if (!this.currentSnapshot) return null;
    return {
      hostPeerId: this.currentSnapshot.hostPeerId,
      seats:      this.currentSnapshot.seats.map(s => ({ ...s })),
      spectators: [...this.currentSnapshot.spectators],
      turns:      cloneTurns(this.currentSnapshot.turns),
    };
  }

  getTurns(): TurnState | null {
    if (!this.currentSnapshot) return null;
    return cloneTurns(this.currentSnapshot.turns);
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  private emit(): void {
    if (!this.currentSnapshot) return;
    const snap = this.snapshot()!;
    for (const l of this.listeners) l(snap);
  }

  getMySeat(): SeatIndex | null {
    if (!this.currentSnapshot) return null;
    const seat = this.currentSnapshot.seats.find(s => s.peerId === this.myPeerId);
    return seat ? seat.index : null;
  }

  getOccupant(seatIndex: SeatIndex): string | null {
    if (!this.currentSnapshot) return null;
    return this.currentSnapshot.seats.find(s => s.index === seatIndex)?.peerId ?? null;
  }

  getHostPeerId(): string | null {
    return this.currentSnapshot?.hostPeerId ?? null;
  }

  hasSnapshot(): boolean {
    return this.currentSnapshot !== null;
  }
}

function cloneTurns(t: TurnState): TurnState {
  return {
    enabled:    t.enabled,
    order:      [...t.order],
    activeSeat: t.activeSeat,
    turnNumber: t.turnNumber,
    orderIndex: t.orderIndex,
  };
}
