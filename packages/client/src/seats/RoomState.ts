// Shared types and reliable-channel messages for RoomState.
// See planning/prd--seats-MVP.md and planning/issues/issues--seats-mvp.md (slice #2).

import { SEAT_COLOURS, type SeatColour, type SeatIndex } from './SeatLayout';
import { type TurnState } from './TurnTracker';

export interface SeatEntry {
  index:  SeatIndex;
  colour: SeatColour;
  peerId: string | null;
}

export interface RoomStateSnapshot {
  hostPeerId: string;
  seats:      SeatEntry[];   // length 8, index === position in array
  spectators: string[];
  turns:      TurnState;
  // Per-peer display name lookup. Includes host and all guests; falls back to
  // a UUID slice in the UI if a peer is somehow missing here.
  names:      Record<string, string>;
  // Per-peer Discord avatar URL. Absent entries → render letter-circle.
  avatars:    Record<string, string>;
}

export interface RoomStatePatch {
  seats?:             SeatEntry[];
  spectatorsAdded?:   string[];
  spectatorsRemoved?: string[];
  turns?:             TurnState;
  // Sparse delta of name updates (additions and removals). A `null` value
  // means the peer left and the entry should be deleted.
  names?:             Record<string, string | null>;
  // Sparse delta of avatar updates; `null` means the entry should be deleted.
  avatars?:           Record<string, string | null>;
}

export type RoomStateMessage =
  | { type: 'room-state';         snapshot: RoomStateSnapshot }
  | { type: 'room-state-patch';   patch:    RoomStatePatch    }
  | { type: 'seat-claim-request'; seatIndex: SeatIndex        }
  | { type: 'end-turn-request'                                }
  | { type: 'kicked';             reason: 'kick' | 'ban'      };

export const SEAT_COUNT = 8;

export function makeEmptySeats(): SeatEntry[] {
  return SEAT_COLOURS.map((colour, i) => ({
    index:  i as SeatIndex,
    colour,
    peerId: null,
  }));
}
