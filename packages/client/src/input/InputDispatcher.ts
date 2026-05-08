// InputDispatcher — issue #1 of issues--interaction.md.
//
// Single source of `pressed` / `released` / `click` / `hover-start` /
// `hover-end` events on a per-entity `EntityEventBus`. Sibling to
// `ToolDispatcher`, owned by `ThreeCanvas`. Both observe the same canvas
// pointer events independently — neither blocks the other. A press promoted
// into a `GrabTool` carry naturally suppresses `click` via the threshold
// check; no manual coordination.
//
// LMB only. Right-click stays with `ContextMenuController`; middle-click
// stays with the camera controller.
//
// Press-capture pairs `released` to the entity that received `pressed`,
// regardless of where the cursor moves between press and release. `click`
// fires after `released` iff the cursor is still over the captured entity
// AND total travel ≤ 5px AND elapsed < 150ms (matches `GrabTool.MOVE_PX` /
// `HOLD_MS`). Despawn while press-captured drops capture silently — no
// `released`, no `click`.
//
// Issue #2 layers per-frame hover-start / hover-end on top of the same
// raycast plumbing; issue #4 promotes `fireInputEvent` into the dual-fire
// (local + host RPC) entry point.

import * as THREE from 'three';
import { type World } from '../entity/world';
import { type Entity } from '../entity/Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { MeshComponent } from '../entity/components/MeshComponent';
import { isEligibleForInput } from './InputEligibility';

// Shared with GrabTool — a press long / loose enough to start a carry is by
// definition not a click.
const MOVE_PX = 5;
const HOLD_MS = 150;

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
  worldHit?: { x: number; y: number; z: number };
}

export interface InputPickResult {
  entity:   Entity;
  worldHit: { x: number; y: number; z: number };
}

export type EntityPicker = (clientX: number, clientY: number) => InputPickResult | null;

export interface InputDispatcherDeps {
  world:       World;
  camera:      THREE.PerspectiveCamera;
  element:     HTMLElement;
  getSelfSeat: () => SeatIndex | null;
  // Test seam — overrides the topmost-eligible-entity raycast. The default
  // implementation collects every entity's `MeshComponent.group`, runs an
  // intersect against the camera ray, walks parents via `world.pickByObject3D`,
  // and applies `isEligibleForInput`.
  pickAt?: EntityPicker;
  // Test seam — overrides the wall clock used for press timing. Defaults to
  // `performance.now()` so production behaviour is unchanged.
  now?: () => number;
}

interface CaptureState {
  entityId:  string;
  startX:    number;
  startY:    number;
  startT:    number;
  pointerId: number;
}

// Minimal subset of PointerEvent the dispatcher reads — lets unit tests fake
// events without a DOM environment, mirroring `ToolDispatcher.test.ts`.
interface PointerEventLike {
  pointerId: number;
  button:    number;
  clientX:   number;
  clientY:   number;
  shiftKey:  boolean;
  ctrlKey:   boolean;
  altKey:    boolean;
}

export class InputDispatcher {
  private capture: CaptureState | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc       = new THREE.Vector2();
  private readonly pickAt:    EntityPicker;
  private readonly now:       () => number;

  constructor(private readonly deps: InputDispatcherDeps) {
    this.pickAt = deps.pickAt ?? this.defaultPick;
    this.now    = deps.now    ?? (() => performance.now());
    deps.element.addEventListener('pointerdown', this.onPointerDown as unknown as EventListener);
    deps.element.addEventListener('pointermove', this.onPointerMove as unknown as EventListener);
    deps.element.addEventListener('pointerup',   this.onPointerUp   as unknown as EventListener);
  }

  dispose(): void {
    this.deps.element.removeEventListener('pointerdown', this.onPointerDown as unknown as EventListener);
    this.deps.element.removeEventListener('pointermove', this.onPointerMove as unknown as EventListener);
    this.deps.element.removeEventListener('pointerup',   this.onPointerUp   as unknown as EventListener);
    this.capture = null;
  }

  // Single dispatch entry point. Issue #4 grows this into the dual-fire
  // (local + host RPC) seam. For issue #1 it's a thin wrapper over the bus.
  fireInputEvent(entity: Entity, eventName: InputEventName, payload: InputEventPayload): void {
    entity.dispatchEvent(eventName, payload);
  }

  // Per-frame tick — issue #2 hooks hover tracking in here. No-op for issue #1.
  update(_dt: number): void {}

  private onPointerDown = (e: PointerEventLike): void => {
    if (e.button !== 0) return;
    const hit = this.pickAt(e.clientX, e.clientY);
    if (!hit) return;

    this.capture = {
      entityId:  hit.entity.id,
      startX:    e.clientX,
      startY:    e.clientY,
      startT:    this.now(),
      pointerId: e.pointerId,
    };
    this.fireInputEvent(hit.entity, 'pressed', this.buildPayload(e, hit.worldHit));
  };

  private onPointerMove = (_e: PointerEventLike): void => {
    // Hover tracking lands in issue #2.
  };

  private onPointerUp = (e: PointerEventLike): void => {
    if (e.button !== 0) return;
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;

    // Despawn-while-captured: drop capture silently — no `released`, no `click`.
    const handle = this.deps.world.get(capture.entityId);
    if (!handle) return;
    const captured = handle.entity;

    // Re-pick at release time. The captured entity may not be the topmost any
    // more (cursor moved off, or eligibility flipped) — released still fires
    // on `captured`, but click only when the cursor is still over it.
    const releaseHit = this.pickAt(e.clientX, e.clientY);
    const overCaptured = releaseHit?.entity.id === capture.entityId;

    this.fireInputEvent(
      captured,
      'released',
      this.buildPayload(e, overCaptured ? releaseHit?.worldHit : undefined),
    );

    if (!overCaptured) return;
    const dx = e.clientX - capture.startX;
    const dy = e.clientY - capture.startY;
    if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) return;
    if (this.now() - capture.startT >= HOLD_MS) return;

    this.fireInputEvent(captured, 'click', this.buildPayload(e, releaseHit?.worldHit));
  };

  private buildPayload(e: PointerEventLike, worldHit?: { x: number; y: number; z: number }): InputEventPayload {
    const payload: InputEventPayload = {
      seat:     this.deps.getSelfSeat(),
      shiftKey: e.shiftKey,
      ctrlKey:  e.ctrlKey,
      altKey:   e.altKey,
    };
    if (worldHit) payload.worldHit = worldHit;
    return payload;
  }

  // Default raycast-based picker. Walks every entity's MeshComponent.group,
  // intersects the camera ray, recovers the entity via world.pickByObject3D,
  // and filters by `isEligibleForInput`. Returns the topmost eligible hit.
  private defaultPick: EntityPicker = (clientX, clientY) => {
    const rect = this.deps.element.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width)  * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);

    const meshes: THREE.Object3D[] = [];
    this.deps.world.forEach((h) => {
      const mesh = h.get(MeshComponent);
      if (mesh?.group) meshes.push(mesh.group);
    });
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;

    const viewerSeat = this.deps.getSelfSeat();
    for (const hit of hits) {
      const handle = this.deps.world.pickByObject3D(hit.object);
      if (!handle) continue;
      if (!isEligibleForInput(handle.entity, viewerSeat)) continue;
      return {
        entity:   handle.entity,
        worldHit: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      };
    }
    return null;
  };
}
