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
  worldHit?: { x: number; y: number; z: number };
}
