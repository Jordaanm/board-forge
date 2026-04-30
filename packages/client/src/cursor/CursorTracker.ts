// Tracks the latest known cursor position for each peer. Pure data — the
// CursorOverlay reads from it each render frame.

import { type SeatIndex } from '../seats/SeatLayout';

export interface PeerCursor {
  peerId: string;
  seat:   SeatIndex | null;
  x:      number;
  z:      number;
}

export class CursorTracker {
  private cursors = new Map<string, PeerCursor>();

  update(peerId: string, seat: SeatIndex | null, x: number, z: number): void {
    this.cursors.set(peerId, { peerId, seat, x, z });
  }

  remove(peerId: string): void {
    this.cursors.delete(peerId);
  }

  all(): PeerCursor[] {
    return [...this.cursors.values()];
  }

  clear(): void {
    this.cursors.clear();
  }
}
