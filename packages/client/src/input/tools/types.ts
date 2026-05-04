// Tool framework — issue 2a of issues--tools.md.
//
// A Tool encapsulates one interaction mode (grab, flick, ping, ...). Exactly
// one tool is active per peer; it owns left-click. The dispatcher owns the
// pointer event listeners, raycasting, and NDC math, and routes events to the
// active tool. Right-click and middle/wheel stay with their existing owners.

import * as THREE from 'three';
import { type World, type EntityHandle } from '../../entity/world';
import { type SeatIndex } from '../../seats/SeatLayout';

export interface ToolPointerEvent {
  pointerId: number;
  button:    number;
  clientX:   number;
  clientY:   number;
  ndc:       THREE.Vector2;
  ray:       THREE.Ray;
  timestamp: number;
  shiftKey:  boolean;
  ctrlKey:   boolean;
  altKey:    boolean;
}

// Passed into every tool hook. Holds the shared raycasting / scene plumbing
// so the tool itself stays a pure interaction strategy.
export interface ToolContext {
  world:       World;
  scene:       THREE.Scene;
  camera:      THREE.PerspectiveCamera;
  element:     HTMLElement;
  raycaster:   THREE.Raycaster;
  getSelfSeat: () => SeatIndex | null;
}

export interface Tool {
  readonly id:         string;
  readonly label:      string;
  readonly hotkey?:    string;
  readonly cursorHint?: string;

  onActivate?  (ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;

  // Implicit consumed semantics: if a tool defines onPress and it runs, the
  // dispatcher considers the press consumed.
  onPress?  (e: ToolPointerEvent, ctx: ToolContext): void;
  onMove?   (e: ToolPointerEvent, ctx: ToolContext): void;
  onRelease?(e: ToolPointerEvent, ctx: ToolContext): void;

  // Per-frame tick. Called by the dispatcher each animation frame.
  update?(dt: number, ctx: ToolContext): void;

  // Escape during an active gesture calls this. No-op default if unset.
  onCancel?(ctx: ToolContext): void;

  // True while the tool holds an in-progress press it hasn't yet released.
  // Tool switches and Escape consult this.
  hasActiveGesture(): boolean;
}

// Reusable per-entity overlay anchored on a target. Tools own attach/detach
// lifecycle. AxisGizmoAttachment / FlickArrowAttachment are the first two
// concrete implementations.
export interface ToolAttachment {
  attach(handle: EntityHandle, ctx: ToolContext): void;
  detach(): void;
  update(dt: number): void;
  isAttached(): boolean;
}
