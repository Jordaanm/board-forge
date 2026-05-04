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
// `tool` is a cosmetic decoration hint (issue #3 of issues--tools.md) — it's
// the sender's currently active tool id, used by CursorOverlay to draw a
// per-tool decoration on the peer's cursor. Optional for backward compat.
export interface CursorPosition {
  type:   'cursor-position';
  peerId: string;
  seat:   SeatIndex | null;
  x:      number;
  z:      number;
  tool?:  string;
}

export type ChannelMessage = SceneMessage | GuestInputMessage | RoomStateMessage | CursorPosition;
