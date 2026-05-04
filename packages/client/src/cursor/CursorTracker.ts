// Tracks the latest known cursor position for each peer. Pure data — the
// CursorOverlay reads from it each render frame.

import { type SeatIndex } from '../seats/SeatLayout';

export interface PeerCursor {
  peerId: string;
  seat:   SeatIndex | null;
  x:      number;
  z:      number;
  // Sender's active tool id (issue #3 of issues--tools.md). Optional for
  // backward compatibility — older messages without the field render the
  // default cursor with no decoration.
  tool?:  string;
}

export class CursorTracker {
  private cursors = new Map<string, PeerCursor>();

  update(peerId: string, seat: SeatIndex | null, x: number, z: number, tool?: string): void {
    this.cursors.set(peerId, { peerId, seat, x, z, tool });
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
