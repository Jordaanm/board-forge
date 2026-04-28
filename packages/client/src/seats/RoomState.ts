// Shared types and reliable-channel messages for RoomState.
// See planning/prd--seats-MVP.md and planning/issues/issues--seats-mvp.md (slice #2).

import { SEAT_COLOURS, type SeatColour, type SeatIndex } from './SeatLayout';

export interface SeatEntry {
  index:  SeatIndex;
  colour: SeatColour;
  peerId: string | null;
}

export interface RoomStateSnapshot {
  hostPeerId: string;
  seats:      SeatEntry[];   // length 8, index === position in array
  spectators: string[];
}

export interface RoomStatePatch {
  seats?:             SeatEntry[];
  spectatorsAdded?:   string[];
  spectatorsRemoved?: string[];
}

export type RoomStateMessage =
  | { type: 'room-state';       snapshot: RoomStateSnapshot }
  | { type: 'room-state-patch'; patch:    RoomStatePatch    };

export const SEAT_COUNT = 8;

export function makeEmptySeats(): SeatEntry[] {
  return SEAT_COLOURS.map((colour, i) => ({
    index:  i as SeatIndex,
    colour,
    peerId: null,
  }));
}
