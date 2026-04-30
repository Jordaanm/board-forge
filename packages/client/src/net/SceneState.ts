// Wire types for room + scene channels. Slice #4 of issues--scene-graph.md
// stripped the legacy ObjectState / snapshot / patch / update-props /
// table-update messages — scene replication now flows through the v2 wire
// shapes in `entity/wire.ts`.

import type { RoomStateMessage } from '../seats/RoomState';
import type { SceneMessage } from '../entity/wire';
import type { SeatIndex } from '../seats/SeatLayout';

export type SpawnableType = 'board' | 'die' | 'token';

export type GuestInputMessage =
  | { type: 'guest-drag-start'; objectId: string }
  | { type: 'guest-drag-move';  objectId: string; px: number; py: number; pz: number }
  | { type: 'guest-drag-end';   objectId: string; vx: number; vy: number; vz: number };

// Live pointer position broadcast to all peers. Sent ~30Hz while the pointer
// is over the table; receivers render a circle in the sender's seat colour.
export interface CursorPosition {
  type:   'cursor-position';
  peerId: string;
  seat:   SeatIndex | null;
  x:      number;
  z:      number;
}

export type ChannelMessage = SceneMessage | GuestInputMessage | RoomStateMessage | CursorPosition;
