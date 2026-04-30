import * as THREE from 'three';
import { CARRY_LIFT_HEIGHT, THROW_VELOCITY_WINDOW_MS } from '../config/dragConfig';
import { Scene, findEntityByObject3D } from '../entity/Scene';
import { type Entity } from '../entity/Entity';
import { TransformComponent } from '../entity/components/TransformComponent';
import { type ChannelMessage } from '../net/SceneState';
import { type SeatIndex } from '../seats/SeatLayout';
import { canManipulate } from '../seats/OwnershipPolicy';
import { type MoveGizmo, type GizmoAxis } from '../scene/MoveGizmo';
import { projectRayOntoAxis } from './axisDrag';

const VELOCITY_SAMPLES = 20;
const HOLD_MS = 150;
const MOVE_PX = 5;

type Pending = {
  entity:    Entity;
  startX:    number;
  startY:    number;
  startT:    number;
  pointerId: number;
};

type AxisDrag = {
  entity:    Entity;
  axis:      THREE.Vector3;
  origin:    THREE.Vector3;
  grabAxisT: number;
};

type State = 'idle' | 'pendingClaim' | 'dragging';

export class GuestDragController {
  private state:         State = 'idle';
  private pending:       Pending | null = null;
  private pendingClaim:  Entity | null = null;
  private heldEntity:    Entity | null = null;
  private pendingEmpty:  { pointerId: number } | null = null;
  private axisDrag:      AxisDrag | null = null;
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
    private readonly gizmo:       MoveGizmo,
    private readonly send:        (msg: ChannelMessage) => void,
    private readonly getSelfSeat: () => SeatIndex | null,
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

  // Per slice #6: drag start gated by OwnershipPolicy. Spectators (peerSeat
  // === null) and non-owner seated peers are refused — no hold-claim sent.
  canStartDrag(entity: Entity): boolean {
    return canManipulate({ peerSeat: this.getSelfSeat(), isHost: false }, entity.owner);
  }

  // Per-frame: promote a pending claim to dragging once the host's accept
  // echoes back (entity.heldBy === self seat). Drag UI is deferred until
  // this transition fires, matching the slice's "defers UI feedback" rule.
  update() {
    if (this.pending && performance.now() - this.pending.startT >= HOLD_MS) {
      this.beginDrag(this.pending);
    }
    if (this.state === 'pendingClaim' && this.pendingClaim) {
      const seat = this.getSelfSeat();
      if (seat !== null && this.pendingClaim.heldBy === seat) {
        this.activateDrag(this.pendingClaim);
      }
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
    if (e.button !== 0 || this.state !== 'idle' || this.axisDrag || this.pending || this.pendingEmpty) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Gizmo arms take priority over the object body.
    const axisName = this.gizmo.pickAxis(this.raycaster);
    if (axisName) {
      const target = this.gizmo.getTarget();
      const entity = target ? findEntityByObject3D(target) : undefined;
      if (entity && entity.type !== 'board' && this.canStartDrag(entity)) {
        this.beginAxisDrag(entity, axisName);
        this.element.setPointerCapture(e.pointerId);
        return;
      }
    }

    const meshes: THREE.Object3D[] = [];
    for (const ent of Scene.all()) {
      const t = ent.getComponent(TransformComponent);
      if (t?.object3d) meshes.push(t.object3d);
    }
    const hits = this.raycaster.intersectObjects(meshes, true);

    if (hits.length === 0) {
      this.pendingEmpty = { pointerId: e.pointerId };
      this.element.setPointerCapture(e.pointerId);
      return;
    }

    const entity = findEntityByObject3D(hits[0].object);
    if (!entity) return;
    if (!this.canStartDrag(entity)) return;

    this.pending = {
      entity,
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
      const px = a.origin.x + a.axis.x * delta;
      const py = a.origin.y + a.axis.y * delta;
      const pz = a.origin.z + a.axis.z * delta;
      this.send({ type: 'guest-drag-move', objectId: a.entity.id, px, py, pz });
      return;
    }

    if (this.pending) {
      const dx = e.clientX - this.pending.startX;
      const dy = e.clientY - this.pending.startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) this.beginDrag(this.pending);
    }
    if (this.state !== 'dragging' || !this.heldEntity) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pt = this.castToCarryPlane();
    if (!pt) return;
    this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
    this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    if (this.velHistory.length > VELOCITY_SAMPLES) this.velHistory.shift();
    this.send({ type: 'guest-drag-move', objectId: this.heldEntity.id,
                px: this.carryTarget.x, py: this.holdY, pz: this.carryTarget.z });
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0) return;

    if (this.axisDrag) {
      this.send({ type: 'hold-release', entityId: this.axisDrag.entity.id });
      this.axisDrag = null;
      return;
    }

    if (this.state === 'dragging' && this.heldEntity) {
      const vel = this.computeThrowVelocity();
      this.send({
        type: 'hold-release', entityId: this.heldEntity.id,
        vx: vel.x, vy: 0, vz: vel.z,
      });
      this.heldEntity = null;
      this.velHistory.length = 0;
      this.state = 'idle';
      return;
    }

    if (this.state === 'pendingClaim' && this.pendingClaim) {
      // Host may have accepted but the echo hasn't arrived; release defensively
      // (idempotent on host — if heldBy was never us, the call no-ops).
      this.send({ type: 'hold-release', entityId: this.pendingClaim.id });
      this.pendingClaim = null;
      this.state = 'idle';
      return;
    }

    if (this.pending) {
      this.onSelect(this.pending.entity.id);
      this.pending = null;
      return;
    }

    if (this.pendingEmpty) {
      this.onSelect(null);
      this.pendingEmpty = null;
    }
  };

  private beginDrag(p: Pending) {
    this.pending = null;
    if (p.entity.type === 'board') return; // guests cannot drag boards
    if (p.entity.heldBy !== null)   return; // already held by someone
    if (!this.canStartDrag(p.entity)) return; // ownership refused

    const seat = this.getSelfSeat();
    if (seat === null) return;

    this.state = 'pendingClaim';
    this.pendingClaim = p.entity;
    this.send({ type: 'hold-claim', entityId: p.entity.id, seat });
  }

  // Drag UI activates only after the host's hold-claim echo confirms the
  // entity's heldBy === self seat.
  private activateDrag(entity: Entity) {
    this.state = 'dragging';
    this.heldEntity = entity;
    this.pendingClaim = null;
    this.velHistory.length = 0;
    const t = entity.getComponent(TransformComponent);
    const meshY = t?.object3d.position.y ?? 0;
    this.holdY = meshY + CARRY_LIFT_HEIGHT;
    this.carryPlane.constant = -this.holdY;
    const pt = this.castToCarryPlane();
    if (pt) {
      const meshX = t?.object3d.position.x ?? 0;
      const meshZ = t?.object3d.position.z ?? 0;
      this.holdOffsetX = meshX - pt.x;
      this.holdOffsetZ = meshZ - pt.z;
      this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
      this.velHistory.push({ pos: pt.clone(), t: performance.now() });
      this.send({ type: 'guest-drag-move', objectId: entity.id,
                  px: this.carryTarget.x, py: this.holdY, pz: this.carryTarget.z });
    } else {
      this.holdOffsetX = 0;
      this.holdOffsetZ = 0;
    }
  }

  private beginAxisDrag(entity: Entity, axisName: GizmoAxis) {
    const seat = this.getSelfSeat();
    if (seat === null) return;
    if (entity.heldBy !== null) return;
    if (!this.canStartDrag(entity)) return;

    const t = entity.getComponent(TransformComponent);
    const origin = t ? t.object3d.position.clone() : new THREE.Vector3();
    const axis = axisName === 'x' ? new THREE.Vector3(1, 0, 0)
              :  axisName === 'y' ? new THREE.Vector3(0, 1, 0)
              :                     new THREE.Vector3(0, 0, 1);
    const grabT = projectRayOntoAxis(this.raycaster.ray, origin, axis, this.camera.position);

    this.axisDrag = { entity, axis, origin, grabAxisT: grabT ?? 0 };
    this.send({ type: 'hold-claim', entityId: entity.id, seat });
    this.send({ type: 'guest-drag-move', objectId: entity.id,
                px: origin.x, py: origin.y, pz: origin.z });
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
