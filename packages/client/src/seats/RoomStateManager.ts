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

export interface SeatedPeer { seat: SeatIndex; peerId: string; }

export interface RoomStateChange {
  patch:    RoomStatePatch;
  snapshot: RoomStateSnapshot;
}

type Listener = (change: RoomStateChange) => void;

export class RoomStateManager {
  private readonly hostPeerId: string;
  private readonly seats: SeatEntry[] = makeEmptySeats();
  private readonly spectators: string[] = [];
  private readonly listeners: Listener[] = [];

  constructor(hostPeerId: string) {
    this.hostPeerId = hostPeerId;
    this.seats[0].peerId = hostPeerId;
  }

  assignOnJoin(peerId: string): void {
    if (this.locate(peerId)) return;

    const empty = this.seats.find(s => s.peerId === null);
    if (empty) {
      empty.peerId = peerId;
      this.emit({ seats: [{ ...empty }] });
      return;
    }

    this.spectators.push(peerId);
    this.emit({ spectatorsAdded: [peerId] });
  }

  removePeer(peerId: string): void {
    const seated = this.seats.find(s => s.peerId === peerId);
    if (seated) {
      seated.peerId = null;
      this.emit({ seats: [{ ...seated }] });
      return;
    }

    const idx = this.spectators.indexOf(peerId);
    if (idx === -1) return;
    this.spectators.splice(idx, 1);
    this.emit({ spectatorsRemoved: [peerId] });
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
    };
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
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
      (!patch.spectatorsRemoved || patch.spectatorsRemoved.length === 0)
    ) return;

    const change: RoomStateChange = { patch, snapshot: this.snapshot() };
    for (const l of this.listeners) l(change);
  }
}

// Re-export so callers can type the seat count without a separate import.
export { SEAT_COUNT };
