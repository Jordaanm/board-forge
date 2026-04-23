import * as THREE from 'three';
import { CARRY_HEIGHT } from './DragController';
import { type SceneEntry, type SceneGraph } from '../scene/SceneGraph';
import { type ChannelMessage } from '../net/SceneState';

const VELOCITY_SAMPLES = 6;
const HOLD_MS = 150;
const MOVE_PX = 5;

type Pending = {
  entry:     SceneEntry;
  startX:    number;
  startY:    number;
  startT:    number;
  pointerId: number;
};

export class GuestDragController {
  private pending: Pending | null = null;
  private pendingEmpty: { pointerId: number } | null = null;
  private heldId:      string | null = null;

  private readonly raycaster   = new THREE.Raycaster();
  private readonly pointer     = new THREE.Vector2();
  private readonly carryPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CARRY_HEIGHT);
  private readonly carryTarget = new THREE.Vector3();
  private readonly velHistory:   { pos: THREE.Vector3; t: number }[] = [];

  constructor(
    private readonly camera:   THREE.PerspectiveCamera,
    private readonly element:  HTMLElement,
    private readonly graph:    SceneGraph,
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
    if (e.button !== 0 || this.heldId || this.pending || this.pendingEmpty) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

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
    this.carryTarget.copy(pt);
    this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    if (this.velHistory.length > VELOCITY_SAMPLES) this.velHistory.shift();
    this.send({ type: 'guest-drag-move', objectId: this.heldId, px: pt.x, py: CARRY_HEIGHT, pz: pt.z });
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0) return;

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
    const pt = this.castToCarryPlane();
    if (pt) {
      this.carryTarget.copy(pt);
      this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    }
  }

  private computeThrowVelocity(): THREE.Vector3 {
    if (this.velHistory.length < 2) return new THREE.Vector3();
    const first = this.velHistory[0];
    const last  = this.velHistory[this.velHistory.length - 1];
    const dt    = (last.t - first.t) / 1000;
    if (dt < 0.001) return new THREE.Vector3();
    return new THREE.Vector3(
      (last.pos.x - first.pos.x) / dt,
      0,
      (last.pos.z - first.pos.z) / dt,
    );
  }
}
