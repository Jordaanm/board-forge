// GrabTool — migrated DragController logic, issue 2a of issues--tools.md.
//
// One GrabTool runs on host and guest. Mutation verbs (tryHold, setPosition,
// release) route through EntityHandle, which the World resolves per role.
// Click vs. carry distinguished by the existing 150ms / 5px thresholds.
// Axis-drag promoted from a gizmo-arm pick. Owns an AxisGizmoAttachment that
// follows the current selection while this tool is active.

import * as THREE from 'three';
import { type EntityHandle } from '../../entity/world';
import { TransformComponent } from '../../entity/components/TransformComponent';
import { PhysicsComponent } from '../../entity/components/PhysicsComponent';
import { CARRY_LIFT_HEIGHT, THROW_VELOCITY_WINDOW_MS } from '../../config/dragConfig';
import { type MoveGizmo, type GizmoAxis } from '../../scene/MoveGizmo';
import { projectRayOntoAxis } from '../axisDrag';
import { type Tool, type ToolContext, type ToolPointerEvent } from './types';
import { type AxisGizmoAttachment } from './AxisGizmoAttachment';
import { findDropTargetAt } from '../dropTargetRegistry';

const VELOCITY_SAMPLES = 20;
const HOLD_MS          = 150;
const MOVE_PX          = 5;

type Pending = {
  handle:    EntityHandle;
  startX:    number;
  startY:    number;
  startT:    number;
  pointerId: number;
};

type AxisDrag = {
  handle:    EntityHandle;
  axis:      THREE.Vector3;
  origin:    THREE.Vector3;
  grabAxisT: number;
  current:   THREE.Vector3;
  active:    boolean;  // false until host echoes the hold-claim
};

type CarryDrag = {
  handle: EntityHandle;
  active: boolean;     // false while waiting for guest hold-claim echo
};

export class GrabTool implements Tool {
  readonly id     = 'grab';
  readonly label  = 'Grab';
  readonly hotkey = '1';

  private pending:      Pending | null = null;
  private pendingEmpty: { pointerId: number } | null = null;
  private carry:        CarryDrag | null = null;
  private axisDrag:     AxisDrag  | null = null;

  private holdOffsetX = 0;
  private holdOffsetZ = 0;
  private holdY       = 0;

  private readonly carryPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly carryTarget = new THREE.Vector3();
  private readonly velHistory:  { pos: THREE.Vector3; t: number }[] = [];

  private active           = false;
  private selectedEntityId: string | null = null;

  constructor(
    private readonly gizmo:      MoveGizmo,
    private readonly attachment: AxisGizmoAttachment,
    private readonly onSelect:   (id: string | null) => void,
  ) {}

  // ── Public API for ThreeCanvas ─────────────────────────────────────────
  setSelection(id: string | null, ctx: ToolContext): void {
    if (this.selectedEntityId === id) return;
    this.selectedEntityId = id;
    if (this.active) this.syncAttachment(ctx);
  }

  hasActiveGesture(): boolean {
    return this.pending !== null
        || this.pendingEmpty !== null
        || this.carry !== null
        || this.axisDrag !== null;
  }

  // ── Tool lifecycle ─────────────────────────────────────────────────────
  onActivate(ctx: ToolContext): void {
    this.active = true;
    this.syncAttachment(ctx);
  }

  onDeactivate(_ctx: ToolContext): void {
    this.active = false;
    this.attachment.detach();
    // Drop any in-flight gesture as a safety net — caller usually rejects
    // tool-switch during an active gesture, but onDeactivate must leave a
    // clean slate either way.
    this.cancelGesture();
  }

  onCancel(_ctx: ToolContext): void {
    this.cancelGesture();
  }

  // ── Pointer hooks ──────────────────────────────────────────────────────
  onPress(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (this.carry || this.axisDrag || this.pending || this.pendingEmpty) return;

    // Gizmo arms take priority over the object body.
    ctx.raycaster.set(e.ray.origin, e.ray.direction);
    const axisName = this.gizmo.pickAxis(ctx.raycaster);
    if (axisName) {
      const target = this.gizmo.getTarget();
      const handle = target ? ctx.world.pickByObject3D(target) : undefined;
      if (handle) {
        if (!handle.canStartDrag()) return;
        const seat = ctx.getSelfSeat();
        if (seat === null) return;
        if (!handle.tryHold(seat)) return;
        this.beginAxisDrag(handle, axisName, ctx);
        ctx.element.setPointerCapture(e.pointerId);
        return;
      }
    }

    const meshes: THREE.Object3D[] = [];
    ctx.world.forEach((h) => {
      const t = h.get(TransformComponent);
      if (t?.object3d) meshes.push(t.object3d);
    });
    const hits = ctx.raycaster.intersectObjects(meshes, true);

    if (hits.length === 0) {
      this.pendingEmpty = { pointerId: e.pointerId };
      ctx.element.setPointerCapture(e.pointerId);
      return;
    }

    const handle = ctx.world.pickByObject3D(hits[0].object);
    if (!handle) return;
    if (!handle.canStartDrag()) return;

    this.pending = {
      handle,
      startX:    e.clientX,
      startY:    e.clientY,
      startT:    e.timestamp,
      pointerId: e.pointerId,
    };
    ctx.element.setPointerCapture(e.pointerId);
  }

  onMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.axisDrag) {
      ctx.raycaster.set(e.ray.origin, e.ray.direction);
      const a = this.axisDrag;
      const t = projectRayOntoAxis(ctx.raycaster.ray, a.origin, a.axis, ctx.camera.position);
      if (t === null) return;
      const delta = t - a.grabAxisT;
      a.current.set(
        a.origin.x + a.axis.x * delta,
        a.origin.y + a.axis.y * delta,
        a.origin.z + a.axis.z * delta,
      );
      return;
    }

    if (this.pending) {
      const dx = e.clientX - this.pending.startX;
      const dy = e.clientY - this.pending.startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) this.beginCarry(this.pending, ctx);
    }
    if (!this.carry) return;
    ctx.raycaster.set(e.ray.origin, e.ray.direction);
    const pt = this.castToCarryPlane(ctx.raycaster);
    if (!pt) return;
    this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
    this.velHistory.push({ pos: pt.clone(), t: e.timestamp });
    if (this.velHistory.length > VELOCITY_SAMPLES) this.velHistory.shift();
  }

  onRelease(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;

    if (this.axisDrag) {
      this.axisDrag.handle.release();
      this.axisDrag = null;
      return;
    }

    if (this.carry) {
      const handle = this.carry.handle;
      const wasActive = this.carry.active;
      this.carry = null;
      if (wasActive) {
        // Drop target under the cursor wins over throw velocity. Releases
        // the hold (no throw) and tweens the entity into the destination
        // hand — zone-enter then runs HandComponent's slot logic.
        const drop = findDropTargetAt(e.clientX, e.clientY);
        if (drop?.kind === 'hand-panel') {
          handle.release();
          ctx.world.tweenIntoHand(handle.entity, drop.handEntityId);
          this.velHistory.length = 0;
          return;
        }
        const vel = this.computeThrowVelocity(e.timestamp);
        handle.release({ vx: vel.x, vy: 0, vz: vel.z });
      } else {
        // Hold-claim never confirmed — defensive release (idempotent on host).
        handle.release();
      }
      this.velHistory.length = 0;
      return;
    }

    if (this.pending) {
      this.onSelect(this.pending.handle.id);
      this.pending = null;
      return;
    }

    if (this.pendingEmpty) {
      this.onSelect(null);
      this.pendingEmpty = null;
    }
  }

  // ── Per-frame tick ─────────────────────────────────────────────────────
  update(_dt: number, ctx: ToolContext): void {
    if (this.pending && performance.now() - this.pending.startT >= HOLD_MS) {
      this.beginCarry(this.pending, ctx);
    }

    if (this.carry && !this.carry.active) {
      const seat = ctx.getSelfSeat();
      if (seat !== null && this.carry.handle.heldBy() === seat) {
        this.carry.active = true;
      }
    }

    if (this.axisDrag && !this.axisDrag.active) {
      const seat = ctx.getSelfSeat();
      if (seat !== null && this.axisDrag.handle.heldBy() === seat) {
        this.axisDrag.active = true;
      }
    }

    if (this.carry?.active) {
      this.carry.handle.setPosition(this.carryTarget.x, this.holdY, this.carryTarget.z);
    }

    if (this.axisDrag?.active) {
      const a = this.axisDrag;
      a.handle.setPosition(a.current.x, a.current.y, a.current.z);
    }

    this.attachment.update(_dt);
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private syncAttachment(ctx: ToolContext): void {
    if (!this.active) {
      this.attachment.detach();
      return;
    }
    if (this.selectedEntityId === null) {
      this.attachment.detach();
      return;
    }
    const handle = ctx.world.get(this.selectedEntityId);
    if (!handle) {
      this.attachment.detach();
      return;
    }
    this.attachment.attach(handle, ctx);
  }

  private cancelGesture(): void {
    if (this.carry) {
      this.carry.handle.release();
      this.carry = null;
    }
    if (this.axisDrag) {
      this.axisDrag.handle.release();
      this.axisDrag = null;
    }
    this.pending      = null;
    this.pendingEmpty = null;
    this.velHistory.length = 0;
  }

  private castToCarryPlane(raycaster: THREE.Raycaster): THREE.Vector3 | null {
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(this.carryPlane, pt) ? pt : null;
  }

  // Promote a pending pointer down to a hold attempt. Sends the hold-claim
  // (host: synchronous; guest: RPC). Carry is "inactive" until the host's
  // echo flips heldBy(); update() activates it on the next tick.
  private beginCarry(p: Pending, ctx: ToolContext): void {
    this.pending = null;
    if (p.handle.entity.heldBy !== null) return;
    if (!p.handle.canStartDrag()) return;
    const seat = ctx.getSelfSeat();
    if (seat === null) return;
    if (!p.handle.tryHold(seat)) return;

    this.carry = { handle: p.handle, active: false };
    this.velHistory.length = 0;

    const t      = p.handle.get(TransformComponent);
    const meshY  = t?.object3d.position.y ?? 0;
    const meshX  = t?.object3d.position.x ?? 0;
    const meshZ  = t?.object3d.position.z ?? 0;
    this.holdY               = meshY + CARRY_LIFT_HEIGHT;
    this.carryPlane.constant = -this.holdY;

    const pt = this.castToCarryPlane(ctx.raycaster);
    if (pt) {
      this.holdOffsetX = meshX - pt.x;
      this.holdOffsetZ = meshZ - pt.z;
      this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
      this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    } else {
      this.holdOffsetX = 0;
      this.holdOffsetZ = 0;
    }
  }

  private beginAxisDrag(handle: EntityHandle, axisName: GizmoAxis, ctx: ToolContext): void {
    const phys = handle.get(PhysicsComponent);
    const t    = handle.get(TransformComponent);
    const pose = phys?.body?.position ?? t?.object3d.position;
    if (!pose) return;
    const axis = axisName === 'x' ? new THREE.Vector3(1, 0, 0)
              :  axisName === 'y' ? new THREE.Vector3(0, 1, 0)
              :                     new THREE.Vector3(0, 0, 1);
    const origin    = new THREE.Vector3(pose.x, pose.y, pose.z);
    const grabAxisT = projectRayOntoAxis(ctx.raycaster.ray, origin, axis, ctx.camera.position) ?? 0;
    this.axisDrag = {
      handle,
      axis,
      origin,
      grabAxisT,
      current: origin.clone(),
      // Host: hold-claim already succeeded synchronously, drag is live.
      // Guest: wait for the host's echo before streaming positions.
      active: ctx.world.get(handle.id) !== undefined && handle.heldBy() === ctx.getSelfSeat(),
    };
  }

  private computeThrowVelocity(now: number): THREE.Vector3 {
    if (this.velHistory.length === 0) return new THREE.Vector3();
    const last   = this.velHistory[this.velHistory.length - 1];
    const cutoff = now - THROW_VELOCITY_WINDOW_MS;
    let first = last;
    for (let i = this.velHistory.length - 1; i >= 0; i--) {
      if (this.velHistory[i].t < cutoff) break;
      first = this.velHistory[i];
    }
    const dt = (now - first.t) / 1000;
    if (dt < 0.001) return new THREE.Vector3();
    return new THREE.Vector3(
      (last.pos.x - first.pos.x) / dt,
      0,
      (last.pos.z - first.pos.z) / dt,
    );
  }
}
