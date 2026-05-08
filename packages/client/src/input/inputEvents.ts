// Shared types for entity-input events (issues--interaction.md).
//
// `InputDispatcher` and `EntityComponent` both consume these — a leaf module
// keeps the dependency one-way (no cycle between input/ and entity/).

import { type SeatIndex } from '../seats/SeatLayout';

export type InputEventName =
  | 'pressed'
  | 'released'
  | 'click'
  | 'hover-start'
  | 'hover-move'   // local-only — see note below.
  | 'hover-end';

// Local-only events: bypass `World.fireInputEvent`'s guest→host RPC and
// dispatch directly on the entity bus. Used for UI affordances that should
// not consume game-state bandwidth.
//   - `hover-move` (issue #5 of issues--ui-surface.md): fires when the hover
//     target is unchanged but the worldHit/uv shifted. Mirror events on the
//     host would be useless and a busy mouse would flood the network.
export const LOCAL_ONLY_INPUT_EVENTS: ReadonlySet<InputEventName> = new Set(['hover-move']);

export interface InputEventPayload {
  seat:      SeatIndex | null;
  shiftKey:  boolean;
  ctrlKey:   boolean;
  altKey:    boolean;
  // Absent on FlatView-originated events (no 3D coords for a 2D tile —
  // Issue #5/#6). Scripts can use `if (e.worldHit)` as a 3D / 2D discriminant.
  worldHit?:  { x: number; y: number; z: number };
  // Surface-plane UV at the hit, populated by InputDispatcher when the picked
  // mesh's THREE.Intersection carried a `uv` (issue #4 of issues--ui-surface.md).
  // SurfaceComponent reads this to forward press/click events onto the
  // covered child element.
  surfaceUV?: { u: number; v: number };
  // Canvas-pixel coordinate derived from `surfaceUV * canvasSize`. Set by
  // SurfaceComponent on the forwarded element-level payload so element
  // scripts can implement sub-element behaviour (drag handles, regional
  // buttons) without re-deriving from the world hit.
  pixel?:     { x: number; y: number };
}
