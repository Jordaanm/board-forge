import * as THREE from 'three';
import { type Entity } from '../entity/Entity';
import { Scene, findEntityByObject3D } from '../entity/Scene';
import { TransformComponent } from '../entity/components/TransformComponent';
import { PhysicsComponent } from '../entity/components/PhysicsComponent';
import { type HoldService } from '../entity/HoldService';
import { type SeatIndex } from '../seats/SeatLayout';
import { CARRY_LIFT_HEIGHT, THROW_VELOCITY_WINDOW_MS } from '../config/dragConfig';
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
  currentX:  number;
  currentY:  number;
  currentZ:  number;
};

export class DragController {
  private pending: Pending | null = null;
  private pendingEmpty: { pointerId: number } | null = null;
  private held:     { entity: Entity } | null = null;
  private axisDrag: AxisDrag | null = null;
  private holdOffsetX = 0;
  private holdOffsetZ = 0;
  private holdY       = 0;

  private readonly raycaster    = new THREE.Raycaster();
  private readonly pointer      = new THREE.Vector2();
  private readonly carryPlane   = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly carryTarget  = new THREE.Vector3();
  private readonly velHistory:    { pos: THREE.Vector3; t: number }[] = [];

  constructor(
    private readonly camera:       THREE.PerspectiveCamera,
    private readonly element:      HTMLElement,
    private readonly hold:         HoldService,
    private readonly getSelfSeat:  () => SeatIndex | null,
    private readonly gizmo:        MoveGizmo,
    private readonly onSelect:     (id: string | null) => void,
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

  update() {
    if (this.axisDrag) {
      const a    = this.axisDrag;
      const body = a.entity.getComponent(PhysicsComponent)?.body;
      if (!body) return;
      body.position.set(a.currentX, a.currentY, a.currentZ);
      return;
    }
    if (this.pending && performance.now() - this.pending.startT >= HOLD_MS) {
      this.beginDrag(this.pending);
    }
    if (!this.held) return;
    const body = this.held.entity.getComponent(PhysicsComponent)?.body;
    if (!body) return;
    body.position.set(this.carryTarget.x, this.holdY, this.carryTarget.z);
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
    if (e.button !== 0 || this.held || this.axisDrag || this.pending || this.pendingEmpty) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const axisName = this.gizmo.pickAxis(this.raycaster);
    if (axisName) {
      const target = this.gizmo.getTarget();
      const entity = target ? findEntityByObject3D(target) : undefined;
      const body   = entity?.getComponent(PhysicsComponent)?.body;
      if (entity && body) {
        if (this.tryHold(entity)) {
          this.beginAxisDrag(entity, axisName);
          this.element.setPointerCapture(e.pointerId);
        }
        return;
      }
    }

    const meshes: THREE.Object3D[] = [];
    for (const entity of Scene.all()) {
      const t = entity.getComponent(TransformComponent);
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
      a.currentX = a.origin.x + a.axis.x * delta;
      a.currentY = a.origin.y + a.axis.y * delta;
      a.currentZ = a.origin.z + a.axis.z * delta;
      return;
    }

    if (this.pending) {
      const dx = e.clientX - this.pending.startX;
      const dy = e.clientY - this.pending.startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) this.beginDrag(this.pending);
    }
    if (!this.held) return;
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
      const entity = this.axisDrag.entity;
      this.axisDrag = null;
      this.hold.release(entity);
      return;
    }

    if (this.held) {
      const entity = this.held.entity;
      this.held = null;
      const vel = this.computeThrowVelocity();
      this.hold.release(entity, { vx: vel.x, vy: 0, vz: vel.z });
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

  private tryHold(entity: Entity): boolean {
    const seat = this.getSelfSeat();
    if (seat === null) return false;
    return this.hold.tryClaim(entity, seat);
  }

  private beginDrag(p: Pending) {
    this.pending = null;
    const body = p.entity.getComponent(PhysicsComponent)?.body;
    if (!body) return;
    if (!this.tryHold(p.entity)) return;

    this.held = { entity: p.entity };
    this.velHistory.length = 0;
    this.holdY = body.position.y + CARRY_LIFT_HEIGHT;
    this.carryPlane.constant = -this.holdY;
    const pt = this.castToCarryPlane();
    if (pt) {
      this.holdOffsetX = body.position.x - pt.x;
      this.holdOffsetZ = body.position.z - pt.z;
      this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
      this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    } else {
      this.holdOffsetX = 0;
      this.holdOffsetZ = 0;
    }
  }

  private beginAxisDrag(entity: Entity, axisName: GizmoAxis) {
    const body = entity.getComponent(PhysicsComponent)!.body;
    const axis = axisName === 'x' ? new THREE.Vector3(1, 0, 0)
              :  axisName === 'y' ? new THREE.Vector3(0, 1, 0)
              :                     new THREE.Vector3(0, 0, 1);
    const origin = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
    const t = projectRayOntoAxis(this.raycaster.ray, origin, axis, this.camera.position);
    this.axisDrag = {
      entity, axis, origin,
      grabAxisT: t ?? 0,
      currentX:  origin.x,
      currentY:  origin.y,
      currentZ:  origin.z,
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
