// Peer-side read-only mirror of host's RoomState.
// See planning/prd--seats-MVP.md.

import { type SeatIndex } from './SeatLayout';
import {
  type RoomStatePatch,
  type RoomStateSnapshot,
  type SeatEntry,
} from './RoomState';

export class RoomStateClient {
  private readonly myPeerId: string;
  private snapshot: RoomStateSnapshot | null = null;

  constructor(myPeerId: string) {
    this.myPeerId = myPeerId;
  }

  applySnapshot(snapshot: RoomStateSnapshot): void {
    this.snapshot = {
      hostPeerId: snapshot.hostPeerId,
      seats:      snapshot.seats.map(s => ({ ...s })),
      spectators: [...snapshot.spectators],
    };
  }

  applyPatch(patch: RoomStatePatch): void {
    if (!this.snapshot) return;

    if (patch.seats) {
      for (const incoming of patch.seats) {
        const existing = this.snapshot.seats.find(s => s.index === incoming.index);
        if (existing) {
          existing.peerId = incoming.peerId;
          existing.colour = incoming.colour;
        }
      }
    }

    if (patch.spectatorsAdded) {
      for (const id of patch.spectatorsAdded) {
        if (!this.snapshot.spectators.includes(id)) this.snapshot.spectators.push(id);
      }
    }

    if (patch.spectatorsRemoved) {
      this.snapshot.spectators = this.snapshot.spectators.filter(
        id => !patch.spectatorsRemoved!.includes(id),
      );
    }
  }

  getMySeat(): SeatIndex | null {
    if (!this.snapshot) return null;
    const seat = this.snapshot.seats.find(s => s.peerId === this.myPeerId);
    return seat ? seat.index : null;
  }

  getOccupant(seatIndex: SeatIndex): string | null {
    if (!this.snapshot) return null;
    return this.snapshot.seats.find(s => s.index === seatIndex)?.peerId ?? null;
  }

  getHostPeerId(): string | null {
    return this.snapshot?.hostPeerId ?? null;
  }

  hasSnapshot(): boolean {
    return this.snapshot !== null;
  }
}
