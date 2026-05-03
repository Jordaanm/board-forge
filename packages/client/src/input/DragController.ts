// Unified pointer-driven drag — issue #3 of issues--arch.md.
//
// One DragController works on host and guest. Mutation verbs (tryHold,
// setPosition, release) route through EntityHandle, which the World resolves
// per role. The host completes a hold-claim synchronously; the guest dispatches
// an RPC and waits for the host's echo to flip `entity.heldBy`. Both paths
// drive the same pending → dragging state machine here.

import * as THREE from 'three';
import { type World, type EntityHandle } from '../entity/world';
import { TransformComponent } from '../entity/components/TransformComponent';
import { PhysicsComponent } from '../entity/components/PhysicsComponent';
import { type SeatIndex } from '../seats/SeatLayout';
import { CARRY_LIFT_HEIGHT, THROW_VELOCITY_WINDOW_MS } from '../config/dragConfig';
import { type MoveGizmo, type GizmoAxis } from '../scene/MoveGizmo';
import { projectRayOntoAxis } from './axisDrag';

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
  handle:     EntityHandle;
  axis:       THREE.Vector3;
  origin:     THREE.Vector3;
  grabAxisT:  number;
  current:    THREE.Vector3;
  active:     boolean;  // false until host echoes the hold-claim
};

type CarryDrag = {
  handle: EntityHandle;
  active: boolean;       // false while waiting for guest hold-claim echo
};

export class DragController {
  private pending:      Pending | null = null;
  private pendingEmpty: { pointerId: number } | null = null;
  private carry:        CarryDrag | null = null;
  private axisDrag:     AxisDrag  | null = null;

  private holdOffsetX = 0;
  private holdOffsetZ = 0;
  private holdY       = 0;

  private readonly raycaster   = new THREE.Raycaster();
  private readonly pointer     = new THREE.Vector2();
  private readonly carryPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly carryTarget = new THREE.Vector3();
  private readonly velHistory:   { pos: THREE.Vector3; t: number }[] = [];

  constructor(
    private readonly camera:      THREE.PerspectiveCamera,
    private readonly element:     HTMLElement,
    private readonly world:       World,
    private readonly getSelfSeat: () => SeatIndex | null,
    private readonly gizmo:       MoveGizmo,
    private readonly onSelect:    (id: string | null) => void,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup',   this.onUp);
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup',   this.onUp);
  }

  // Per-frame: promote pending claims to active drags once the host's echo
  // confirms `heldBy === self seat`, and stream the carry target through the
  // handle (host writes the body; guest sends a guest-drag-move RPC).
  update() {
    if (this.pending && performance.now() - this.pending.startT >= HOLD_MS) {
      this.beginCarry(this.pending);
    }

    if (this.carry && !this.carry.active) {
      const seat = this.getSelfSeat();
      if (seat !== null && this.carry.handle.heldBy() === seat) {
        this.activateCarry(this.carry.handle);
      }
    }

    if (this.axisDrag && !this.axisDrag.active) {
      const seat = this.getSelfSeat();
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
  }

  private setPointer(e: PointerEvent) {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    );
  }

  private castToCarryPlane(): THREE.Vector3 | null {
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.carryPlane, pt) ? pt : null;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.carry || this.axisDrag || this.pending || this.pendingEmpty) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Gizmo arms take priority over the object body.
    const axisName = this.gizmo.pickAxis(this.raycaster);
    if (axisName) {
      const target = this.gizmo.getTarget();
      const handle = target ? this.world.pickByObject3D(target) : undefined;
      if (handle && handle.entity.type !== 'board') {
        if (!handle.canStartDrag()) return;
        const seat = this.getSelfSeat();
        if (seat === null) return;
        if (!handle.tryHold(seat)) return;
        this.beginAxisDrag(handle, axisName);
        this.element.setPointerCapture(e.pointerId);
        return;
      }
    }

    const meshes: THREE.Object3D[] = [];
    this.world.forEach((h) => {
      const t = h.get(TransformComponent);
      if (t?.object3d) meshes.push(t.object3d);
    });
    const hits = this.raycaster.intersectObjects(meshes, true);

    if (hits.length === 0) {
      this.pendingEmpty = { pointerId: e.pointerId };
      this.element.setPointerCapture(e.pointerId);
      return;
    }

    const handle = this.world.pickByObject3D(hits[0].object);
    if (!handle) return;
    if (!handle.canStartDrag()) return;

    this.pending = {
      handle,
      startX:    e.clientX,
      startY:    e.clientY,
      startT:    performance.now(),
      pointerId: e.pointerId,
    };
    this.element.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (this.axisDrag) {
      this.setPointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const a = this.axisDrag;
      const t = projectRayOntoAxis(this.raycaster.ray, a.origin, a.axis, this.camera.position);
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
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) this.beginCarry(this.pending);
    }
    if (!this.carry) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pt = this.castToCarryPlane();
    if (!pt) return;
    this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
    this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    if (this.velHistory.length > VELOCITY_SAMPLES) this.velHistory.shift();
  };

  private onUp = (e: PointerEvent) => {
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
        const vel = this.computeThrowVelocity();
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
  };

  // Promote a pending pointer down to a hold attempt. Sends the hold-claim
  // (host: synchronous; guest: RPC). Carry is "inactive" until the host's
  // echo flips heldBy(); update() activates it on the next tick.
  private beginCarry(p: Pending) {
    this.pending = null;
    if (p.handle.entity.heldBy !== null) return;
    if (!p.handle.canStartDrag()) return;
    const seat = this.getSelfSeat();
    if (seat === null) return;
    if (!p.handle.tryHold(seat)) return;

    this.carry = { handle: p.handle, active: false };
    this.velHistory.length = 0;

    // Compute the carry plane from the entity's *visible* pose (transform's
    // Object3D). Works on both host and guest — host's body is sync'd to
    // transform each tick by PhysicsComponent.syncToTransform.
    const t      = p.handle.get(TransformComponent);
    const meshY  = t?.object3d.position.y ?? 0;
    const meshX  = t?.object3d.position.x ?? 0;
    const meshZ  = t?.object3d.position.z ?? 0;
    this.holdY               = meshY + CARRY_LIFT_HEIGHT;
    this.carryPlane.constant = -this.holdY;

    const pt = this.castToCarryPlane();
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

  private activateCarry(_handle: EntityHandle) {
    if (!this.carry) return;
    this.carry.active = true;
  }

  private beginAxisDrag(handle: EntityHandle, axisName: GizmoAxis) {
    const phys = handle.get(PhysicsComponent);
    const t    = handle.get(TransformComponent);
    const pose = phys?.body?.position ?? t?.object3d.position;
    if (!pose) return;
    const axis = axisName === 'x' ? new THREE.Vector3(1, 0, 0)
              :  axisName === 'y' ? new THREE.Vector3(0, 1, 0)
              :                     new THREE.Vector3(0, 0, 1);
    const origin    = new THREE.Vector3(pose.x, pose.y, pose.z);
    const grabAxisT = projectRayOntoAxis(this.raycaster.ray, origin, axis, this.camera.position) ?? 0;
    this.axisDrag = {
      handle,
      axis,
      origin,
      grabAxisT,
      current: origin.clone(),
      // Host: hold-claim already succeeded synchronously, drag is live.
      // Guest: wait for the host's echo before streaming positions.
      active: this.world.get(handle.id) !== undefined && handle.heldBy() === this.getSelfSeat(),
    };
  }

  private computeThrowVelocity(): THREE.Vector3 {
    if (this.velHistory.length === 0) return new THREE.Vector3();
    const now    = performance.now();
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
