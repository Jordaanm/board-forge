// FlickTool — issues #5a / #5b of issues--tools.md.
//
// Press on an entity → "pending" gesture. From pending, two transitions:
//   * release within 150ms with movement ≤5px → click mode: instant impulse
//     along camera-forward, magnitude = FLICK_DEFAULT_MAGNITUDE.
//   * hold ≥150ms OR move >5px → aim mode: FlickArrowAttachment tracks the
//     pointer, release fires an impulse with pull semantics (opposite of the
//     drag-delta on the table plane). Magnitude scales linearly with drag
//     distance, capped at FLICK_MAX_MAGNITUDE.
// Escape during a gesture detaches the arrow (if attached) and aborts the
// shot. Ownership / lock state are enforced by EntityHandle.applyImpulse.

import * as THREE from 'three';
import { TABLE_SURFACE_Y } from '../../scene/Table';
import { TransformComponent } from '../../entity/components/TransformComponent';
import { FLICK_DEFAULT_MAGNITUDE, FLICK_MAX_MAGNITUDE } from '../../config/flickConfig';
import { type EntityHandle } from '../../entity/world';
import { type Tool, type ToolContext, type ToolPointerEvent } from './types';
import { type FlickArrowAttachment } from './FlickArrowAttachment';

const HOLD_MS              = 150;
const MOVE_PX              = 5;
const DRAG_MAGNITUDE_SCALE = 1.0;   // impulse units per world-unit of drag

interface Pending {
  handle:         EntityHandle;
  pointerId:      number;
  startX:         number;
  startY:         number;
  startT:         number;
  pressOnTable:   THREE.Vector3;
  pointerOnTable: THREE.Vector3;
  aimMode:        boolean;
}

export class FlickTool implements Tool {
  readonly id     = 'flick';
  readonly label  = 'Flick';
  readonly hotkey = '3';

  private pending: Pending | null = null;

  // Test seam — overridden via `(tool as any).now = () => ...`.
  private now: () => number = () => performance.now();

  constructor(private readonly attachment: FlickArrowAttachment) {}

  hasActiveGesture(): boolean {
    return this.pending !== null;
  }

  onPress(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    // Press has to land on an entity for a flick to be meaningful (both
    // click-mode and aim-mode require a target). Empty-space press is a no-op.
    ctx.raycaster.set(e.ray.origin, e.ray.direction);
    const handle = pickEntity(e, ctx);
    if (!handle) return;

    const pressOnTable = projectToTable(e.ray);
    if (!pressOnTable) return;

    this.pending = {
      handle,
      pointerId:      e.pointerId,
      startX:         e.clientX,
      startY:         e.clientY,
      startT:         this.now(),
      pressOnTable,
      pointerOnTable: pressOnTable.clone(),
      aimMode:        false,
    };
  }

  onMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const p = this.pending;
    if (!p) return;

    const tablePoint = projectToTable(e.ray);
    if (tablePoint) p.pointerOnTable.copy(tablePoint);

    if (!p.aimMode) {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) {
        this.enterAimMode(ctx);
      }
    }

    if (p.aimMode) this.refreshAim();
  }

  onRelease(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const p = this.pending;
    this.pending = null;
    if (!p) return;

    // Promote to aim mode if the hold threshold has passed and we never
    // tripped the movement threshold. Drag delta will be ~zero, so the
    // resulting impulse has zero magnitude → no-op fire.
    const elapsed = this.now() - p.startT;
    if (!p.aimMode && elapsed >= HOLD_MS) {
      this.pending = p;            // re-attach so enterAimMode finds it
      this.enterAimMode(ctx);
      this.pending = null;
    }

    if (p.aimMode) {
      this.fireAim(p);
      this.attachment.detach();
      return;
    }

    // Click mode: instant impulse along projected camera-forward.
    const forward = new THREE.Vector3();
    ctx.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    forward.normalize();
    p.handle.applyImpulse({
      x: forward.x * FLICK_DEFAULT_MAGNITUDE,
      y: 0,
      z: forward.z * FLICK_DEFAULT_MAGNITUDE,
    });
  }

  onCancel(_ctx: ToolContext): void {
    if (this.pending?.aimMode) this.attachment.detach();
    this.pending = null;
  }

  onDeactivate(_ctx: ToolContext): void {
    if (this.pending?.aimMode) this.attachment.detach();
    this.pending = null;
  }

  // Per-frame: promote pending → aim mode once the hold threshold passes
  // even before the user moves the pointer. Mirrors GrabTool's update().
  update(_dt: number, ctx: ToolContext): void {
    const p = this.pending;
    if (!p || p.aimMode) {
      this.attachment.update(_dt);
      return;
    }
    if (this.now() - p.startT >= HOLD_MS) this.enterAimMode(ctx);
    this.attachment.update(_dt);
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private enterAimMode(ctx: ToolContext): void {
    const p = this.pending;
    if (!p || p.aimMode) return;
    p.aimMode = true;
    this.attachment.attach(p.handle, ctx);
    this.refreshAim();
  }

  private refreshAim(): void {
    const p = this.pending;
    if (!p || !p.aimMode) return;
    const { direction, magnitude } = this.computeImpulse(p);
    this.attachment.setAim(direction, magnitude);
  }

  private fireAim(p: Pending): void {
    const { direction, magnitude } = this.computeImpulse(p);
    if (magnitude <= 0) return;
    p.handle.applyImpulse({
      x: direction.x * magnitude,
      y: 0,
      z: direction.z * magnitude,
    });
  }

  // Returns the pull-semantics impulse direction (unit vector, opposite of
  // pointer drag) and the projected magnitude (drag distance × scale, capped
  // at FLICK_MAX_MAGNITUDE). Magnitude is 0 when the user never moved.
  private computeImpulse(p: Pending): { direction: THREE.Vector3; magnitude: number } {
    const dx = p.pointerOnTable.x - p.pressOnTable.x;
    const dz = p.pointerOnTable.z - p.pressOnTable.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return { direction: new THREE.Vector3(), magnitude: 0 };
    const direction = new THREE.Vector3(-dx / len, 0, -dz / len);
    const magnitude = Math.min(len * DRAG_MAGNITUDE_SCALE, FLICK_MAX_MAGNITUDE);
    return { direction, magnitude };
  }
}

function pickEntity(_e: ToolPointerEvent, ctx: ToolContext): EntityHandle | null {
  const meshes: THREE.Object3D[] = [];
  ctx.world.forEach((h) => {
    const t = h.get(TransformComponent);
    if (t?.object3d) meshes.push(t.object3d);
  });
  const hits = ctx.raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  return ctx.world.pickByObject3D(hits[0].object) ?? null;
}

function projectToTable(ray: THREE.Ray): THREE.Vector3 | null {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_SURFACE_Y);
  const hit = new THREE.Vector3();
  if (!ray.intersectPlane(plane, hit)) return null;
  return hit;
}
