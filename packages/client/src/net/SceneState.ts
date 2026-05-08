// Wire types for room + scene channels. Slice #4 of issues--scene-graph.md
// stripped the legacy ObjectState / snapshot / patch / update-props
// messages — scene replication now flows through the v2 wire shapes in
// `entity/wire.ts`. The bespoke `table-update` envelope was retired in the
// Table-as-entity refactor (slice 1) once the Table became a regular entity
// and its state began flowing through component-patches like everything else.

import type { RoomStateMessage } from '../seats/RoomState';
import type { SceneMessage, ManifestPublishMessage } from '../entity/wire';
import type { SeatIndex } from '../seats/SeatLayout';
import type { InputEventName, InputEventPayload } from '../input/inputEvents';

// Open string type — the spawnable registry is the source of truth. The old
// closed union became fiction once `card` shipped and won't survive scripting.
export type SpawnableType = string;

// Dual-fire RPC for entity-input events (issue #4 of issues--interaction.md).
// Sent guest → host whenever the local InputDispatcher (or HandPanel for
// FlatView events) fires an event. Host validates `payload.seat` against the
// sender's seat and re-fires on the per-entity bus so host-only scripts see
// every peer's input.
export interface GuestInputEvent {
  type:      'guest-input-event';
  entityId:  string;
  eventName: InputEventName;
  payload:   InputEventPayload;
}

export type GuestInputMessage =
  | { type: 'guest-drag-start'; objectId: string }
  | { type: 'guest-drag-move';  objectId: string; px: number; py: number; pz: number }
  | { type: 'guest-drag-end';   objectId: string; vx: number; vy: number; vz: number }
  | GuestInputEvent;

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

export type ChannelMessage = SceneMessage | GuestInputMessage | RoomStateMessage | CursorPosition | ManifestPublishMessage;
