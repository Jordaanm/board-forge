import * as THREE from 'three';
import { CARRY_LIFT_HEIGHT, THROW_VELOCITY_WINDOW_MS } from '../config/dragConfig';
import { type SceneEntry, type ISceneSystem } from '../scene/SceneGraph';
import { type ChannelMessage } from '../net/SceneState';
import { type MoveGizmo, type GizmoAxis } from '../scene/MoveGizmo';
import { projectRayOntoAxis } from './axisDrag';

const VELOCITY_SAMPLES = 20;
const HOLD_MS = 150;
const MOVE_PX = 5;

type Pending = {
  entry:     SceneEntry;
  startX:    number;
  startY:    number;
  startT:    number;
  pointerId: number;
};

type AxisDrag = {
  objectId:  string;
  axis:      THREE.Vector3;
  origin:    THREE.Vector3;
  grabAxisT: number;
};

export class GuestDragController {
  private pending: Pending | null = null;
  private pendingEmpty: { pointerId: number } | null = null;
  private heldId:      string | null = null;
  private axisDrag:    AxisDrag | null = null;
  private holdOffsetX = 0;
  private holdOffsetZ = 0;
  private holdY       = 0;

  private readonly raycaster   = new THREE.Raycaster();
  private readonly pointer     = new THREE.Vector2();
  private readonly carryPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly carryTarget = new THREE.Vector3();
  private readonly velHistory:   { pos: THREE.Vector3; t: number }[] = [];

  constructor(
    private readonly camera:   THREE.PerspectiveCamera,
    private readonly element:  HTMLElement,
    private readonly graph:    ISceneSystem,
    private readonly gizmo:    MoveGizmo,
    private readonly send:     (msg: ChannelMessage) => void,
    private readonly onSelect: (id: string | null) => void,
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
    if (this.pending && performance.now() - this.pending.startT >= HOLD_MS) {
      this.beginDrag(this.pending);
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
    if (e.button !== 0 || this.heldId || this.axisDrag || this.pending || this.pendingEmpty) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Gizmo arms take priority over the object body.
    const axisName = this.gizmo.pickAxis(this.raycaster);
    if (axisName) {
      const target = this.gizmo.getTarget();
      const entry  = target ? this.graph.findEntry(target) : undefined;
      if (entry && entry.objectType !== 'board') {
        this.beginAxisDrag(entry, axisName);
        this.element.setPointerCapture(e.pointerId);
        return;
      }
    }

    const all  = this.graph.getAll();
    const hits = this.raycaster.intersectObjects(all.map(en => en.mesh), true);

    if (hits.length === 0) {
      this.pendingEmpty = { pointerId: e.pointerId };
      this.element.setPointerCapture(e.pointerId);
      return;
    }

    const entry = this.graph.findEntry(hits[0].object);
    if (!entry) return;

    this.pending = {
      entry,
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
      this.send({ type: 'guest-drag-move', objectId: a.objectId, px, py, pz });
      return;
    }

    if (this.pending) {
      const dx = e.clientX - this.pending.startX;
      const dy = e.clientY - this.pending.startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) this.beginDrag(this.pending);
    }
    if (!this.heldId) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pt = this.castToCarryPlane();
    if (!pt) return;
    this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
    this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    if (this.velHistory.length > VELOCITY_SAMPLES) this.velHistory.shift();
    this.send({ type: 'guest-drag-move', objectId: this.heldId,
                px: this.carryTarget.x, py: this.holdY, pz: this.carryTarget.z });
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0) return;

    if (this.axisDrag) {
      this.send({ type: 'guest-drag-end', objectId: this.axisDrag.objectId, vx: 0, vy: 0, vz: 0 });
      this.axisDrag = null;
      return;
    }

    if (this.heldId) {
      const vel = this.computeThrowVelocity();
      this.send({ type: 'guest-drag-end', objectId: this.heldId, vx: vel.x, vy: 0, vz: vel.z });
      this.heldId = null;
      this.velHistory.length = 0;
      return;
    }

    if (this.pending) {
      this.onSelect(this.pending.entry.id);
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
    // Guests cannot drag boards; stays un-selected. Tap-to-select requires pointerup.
    if (p.entry.objectType === 'board') return;
    this.heldId = p.entry.id;
    this.velHistory.length = 0;
    this.send({ type: 'guest-drag-start', objectId: p.entry.id });
    this.holdY = p.entry.mesh.position.y + CARRY_LIFT_HEIGHT;
    this.carryPlane.constant = -this.holdY;
    const pt = this.castToCarryPlane();
    if (pt) {
      this.holdOffsetX = p.entry.mesh.position.x - pt.x;
      this.holdOffsetZ = p.entry.mesh.position.z - pt.z;
      this.carryTarget.set(pt.x + this.holdOffsetX, this.holdY, pt.z + this.holdOffsetZ);
      this.velHistory.push({ pos: pt.clone(), t: performance.now() });
      // Send initial position so host's GuestInputHandler does not snap the body to (0,_,0).
      this.send({ type: 'guest-drag-move', objectId: p.entry.id,
                  px: this.carryTarget.x, py: this.holdY, pz: this.carryTarget.z });
    } else {
      this.holdOffsetX = 0;
      this.holdOffsetZ = 0;
    }
  }

  private beginAxisDrag(entry: SceneEntry, axisName: GizmoAxis) {
    const axis = axisName === 'x' ? new THREE.Vector3(1, 0, 0)
              :  axisName === 'y' ? new THREE.Vector3(0, 1, 0)
              :                     new THREE.Vector3(0, 0, 1);
    const origin = entry.mesh.position.clone();
    const t = projectRayOntoAxis(this.raycaster.ray, origin, axis, this.camera.position);
    this.axisDrag = {
      objectId:  entry.id,
      axis,
      origin,
      grabAxisT: t ?? 0,
    };
    this.send({ type: 'guest-drag-start', objectId: entry.id });
    // Seed position so host's GuestInputHandler doesn't snap to (0,_,0) before
    // the first pointermove arrives.
    this.send({ type: 'guest-drag-move',  objectId: entry.id,
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
