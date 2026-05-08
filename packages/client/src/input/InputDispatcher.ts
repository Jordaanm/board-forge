// InputDispatcher — issues #1 and #2 of issues--interaction.md.
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
// Hover (issue #2) re-raycasts each frame from the last pointer position so
// transitions fire correctly when entities move under a stationary cursor.
// Hover skips entities currently held by the viewer (carry suppression — the
// "see-through-the-carried" rule from User Story 15). Despawn or eligibility
// flip while hovered drops the hover-target silently — no synthetic
// `hover-end`; only natural pointer transitions emit it.
//
// Issue #4 promotes `fireInputEvent` into the dual-fire (local + host RPC)
// entry point.

import * as THREE from 'three';
import { type World } from '../entity/world';
import { type Entity } from '../entity/Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { MeshComponent } from '../entity/components/MeshComponent';
import { isEligibleForInput } from './InputEligibility';
import { type InputEventName, type InputEventPayload } from './inputEvents';

export type { InputEventName, InputEventPayload } from './inputEvents';

// Shared with GrabTool — a press long / loose enough to start a carry is by
// definition not a click.
const MOVE_PX = 5;
const HOLD_MS = 150;

export interface InputPickResult {
  entity:   Entity;
  worldHit: { x: number; y: number; z: number };
}

// Returns the list of entities under the pointer, sorted near→far. The
// dispatcher applies eligibility and carry filters on top — keeping the
// picker filter-free lets hover "see through" the carried entity to entities
// below.
export type EntityPicker = (clientX: number, clientY: number) => InputPickResult[];

export interface InputDispatcherDeps {
  world:       World;
  camera:      THREE.PerspectiveCamera;
  element:     HTMLElement;
  getSelfSeat: () => SeatIndex | null;
  // Test seam — overrides the raycast against `MeshComponent.group` Object3Ds.
  // Default impl walks every entity's mesh group, intersects, and resolves
  // each hit through `world.pickByObject3D` (deduped by entity).
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
  private capture:   CaptureState | null = null;
  private hoveredId: string | null       = null;
  private lastPointer: PointerEventLike | null = null;

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
    this.capture     = null;
    this.hoveredId   = null;
    this.lastPointer = null;
  }

  // Single dual-fire entry point — delegates to `World.fireInputEvent` so the
  // local bus dispatch and the (guest-only) `guest-input-event` RPC stay in
  // lockstep. HandPanel (issues #5/#6) routes through this same method.
  fireInputEvent(entity: Entity, eventName: InputEventName, payload: InputEventPayload): void {
    this.deps.world.fireInputEvent(entity, eventName, payload);
  }

  // Per-frame tick — re-raycasts from the last pointer position and fires
  // hover-start / hover-end on transitions. Catches "entity moves under
  // stationary cursor" because the raycast is keyed on time, not pointer
  // events.
  update(_dt: number): void {
    if (!this.lastPointer) return;
    const target = this.pickHoverTarget(this.lastPointer.clientX, this.lastPointer.clientY);
    const newId  = target?.entity.id ?? null;
    if (newId === this.hoveredId) return;

    const seat = this.deps.getSelfSeat();
    const oldId = this.hoveredId;
    this.hoveredId = newId;

    if (oldId !== null) {
      // Fire hover-end only on a natural pointer transition. If the old
      // entity has despawned, become ineligible, or been picked up by the
      // viewer mid-hover, drop the hover-target silently.
      const oldHandle = this.deps.world.get(oldId);
      const naturalTransition = !!oldHandle
        && isEligibleForInput(oldHandle.entity, seat)
        && oldHandle.entity.heldBy !== seat;
      if (naturalTransition) {
        this.fireInputEvent(
          oldHandle.entity,
          'hover-end',
          this.buildHoverPayload(seat, undefined),
        );
      }
    }

    if (target) {
      this.fireInputEvent(
        target.entity,
        'hover-start',
        this.buildHoverPayload(seat, target.worldHit),
      );
    }
  }

  private onPointerDown = (e: PointerEventLike): void => {
    this.lastPointer = e;
    if (e.button !== 0) return;
    const hit = this.pickPressTarget(e.clientX, e.clientY);
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

  private onPointerMove = (e: PointerEventLike): void => {
    this.lastPointer = e;
  };

  private onPointerUp = (e: PointerEventLike): void => {
    this.lastPointer = e;
    if (e.button !== 0) return;
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;

    // Despawn-while-captured: drop capture silently — no `released`, no `click`.
    const handle = this.deps.world.get(capture.entityId);
    if (!handle) return;
    const captured = handle.entity;

    // Re-pick at release time. The captured entity may not be the topmost
    // any more (cursor moved off, or eligibility flipped) — `released` still
    // fires on `captured`, but `click` only when the cursor is still over it.
    const releaseHit = this.pickPressTarget(e.clientX, e.clientY);
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

  // Press uses eligibility-only filtering. Carry suppression doesn't apply —
  // a press on a held-by-self entity is unreachable in normal use (the press
  // that started the carry has already released).
  private pickPressTarget(clientX: number, clientY: number): InputPickResult | null {
    const seat = this.deps.getSelfSeat();
    for (const hit of this.pickAt(clientX, clientY)) {
      if (isEligibleForInput(hit.entity, seat)) return hit;
    }
    return null;
  }

  // Hover skips eligibility AND entities held by the viewer ("see through"
  // the carried object onto entities below — User Story 15).
  private pickHoverTarget(clientX: number, clientY: number): InputPickResult | null {
    const seat = this.deps.getSelfSeat();
    for (const hit of this.pickAt(clientX, clientY)) {
      if (!isEligibleForInput(hit.entity, seat)) continue;
      if (hit.entity.heldBy === seat) continue;
      return hit;
    }
    return null;
  }

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

  // Hover events fire from the per-frame tick, so there's no PointerEvent in
  // hand. Modifier keys are read from the last pointer event the dispatcher
  // observed — keeps `shiftKey` etc. populated consistently with click events
  // even when hover transitions are entity-driven (entity moves under a
  // stationary cursor).
  private buildHoverPayload(seat: SeatIndex | null, worldHit?: { x: number; y: number; z: number }): InputEventPayload {
    const last = this.lastPointer;
    const payload: InputEventPayload = {
      seat,
      shiftKey: last?.shiftKey ?? false,
      ctrlKey:  last?.ctrlKey  ?? false,
      altKey:   last?.altKey   ?? false,
    };
    if (worldHit) payload.worldHit = worldHit;
    return payload;
  }

  // Default raycast-based picker. Walks every entity's `MeshComponent.group`,
  // runs an intersect, and resolves each hit through `world.pickByObject3D`.
  // Dedupes by entity (multi-mesh entities can produce multiple hits) and
  // returns the list sorted near→far. Eligibility / carry filtering is left
  // to the caller.
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
    if (hits.length === 0) return [];

    const results: InputPickResult[] = [];
    const seen   = new Set<string>();
    for (const hit of hits) {
      const handle = this.deps.world.pickByObject3D(hit.object);
      if (!handle) continue;
      if (seen.has(handle.entity.id)) continue;
      seen.add(handle.entity.id);
      results.push({
        entity:   handle.entity,
        worldHit: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      });
    }
    return results;
  };
}
