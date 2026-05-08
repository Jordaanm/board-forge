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
  | 'hover-end';

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
