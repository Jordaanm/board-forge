import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TABLE_SURFACE_Y } from '../scene/Table';

const CARRY_HEIGHT = TABLE_SURFACE_Y + 1.5;
const VELOCITY_SAMPLES = 6;

export class DragController {
  private held = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly carryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CARRY_HEIGHT);
  private readonly carryTarget = new THREE.Vector3();
  private readonly velHistory: { pos: THREE.Vector3; t: number }[] = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly tokenMesh: THREE.Mesh,
    private readonly tokenBody: CANNON.Body,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup', this.onUp);
  }

  // Call each frame after physics.step(), before syncing mesh.
  update() {
    if (!this.held) return;
    this.tokenBody.wakeUp();
    this.tokenBody.position.set(this.carryTarget.x, CARRY_HEIGHT, this.carryTarget.z);
    this.tokenBody.velocity.setZero();
    this.tokenBody.angularVelocity.setZero();
  }

  private setPointer(e: PointerEvent) {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private castToCarryPlane(): THREE.Vector3 | null {
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.carryPlane, pt) ? pt : null;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.held) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObject(this.tokenMesh).length === 0) return;

    this.held = true;
    this.velHistory.length = 0;
    this.tokenBody.wakeUp();

    const pt = this.castToCarryPlane();
    if (pt) {
      this.carryTarget.copy(pt);
      this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    }
    this.element.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.held) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pt = this.castToCarryPlane();
    if (!pt) return;
    this.carryTarget.copy(pt);
    this.velHistory.push({ pos: pt.clone(), t: performance.now() });
    if (this.velHistory.length > VELOCITY_SAMPLES) this.velHistory.shift();
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.held) return;
    this.held = false;

    const vel = this.computeThrowVelocity();
    this.tokenBody.velocity.set(vel.x, 0, vel.z);
    this.tokenBody.angularVelocity.setZero();
    this.tokenBody.wakeUp();
  };

  private computeThrowVelocity(): THREE.Vector3 {
    if (this.velHistory.length < 2) return new THREE.Vector3();
    const first = this.velHistory[0];
    const last = this.velHistory[this.velHistory.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.001) return new THREE.Vector3();
    return new THREE.Vector3(
      (last.pos.x - first.pos.x) / dt,
      0,
      (last.pos.z - first.pos.z) / dt,
    );
  }
}
