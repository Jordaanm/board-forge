// FlickArrowAttachment — issue #5b of issues--tools.md.
//
// Renders a preview arrow originating at the target entity, pointing in the
// computed impulse direction (pull semantics — opposite of pointer drag),
// scaled by the projected magnitude. Local-only — never replicated to peers.

import * as THREE from 'three';
import { type EntityHandle } from '../../entity/world';
import { TransformComponent } from '../../entity/components/TransformComponent';
import { type ToolAttachment, type ToolContext } from './types';

const ARROW_COLOR     = 0xffaa33;
const ARROW_HEAD_LEN  = 0.18;
const ARROW_HEAD_W    = 0.14;
const ARROW_LIFT      = 0.05;   // tiny lift above the entity origin
const VISUAL_SCALE    = 1.5;    // multiplier from impulse magnitude → arrow length

export class FlickArrowAttachment implements ToolAttachment {
  private arrow:     THREE.ArrowHelper | null = null;
  private targetObj: THREE.Object3D | null = null;
  private attached  = false;

  constructor(private readonly scene: THREE.Scene) {}

  attach(handle: EntityHandle, _ctx: ToolContext): void {
    const obj = handle.get(TransformComponent)?.object3d;
    if (!obj) return;
    this.targetObj = obj;
    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      0.001,
      ARROW_COLOR,
      ARROW_HEAD_LEN,
      ARROW_HEAD_W,
    );
    // Draw on top of the table / target so the arrow stays readable.
    this.arrow.traverse((child) => {
      const mat = (child as THREE.Mesh | THREE.Line).material as THREE.Material | undefined;
      if (mat) { mat.depthTest = false; mat.transparent = true; }
      child.renderOrder = 1100;
    });
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.attached = true;
  }

  // Caller (FlickTool) supplies the impulse direction (pull-semantics) and
  // its magnitude. Magnitude ≤ 0 hides the arrow.
  setAim(direction: THREE.Vector3, magnitude: number): void {
    if (!this.arrow) return;
    if (magnitude <= 0 || direction.lengthSq() < 1e-6) {
      this.arrow.visible = false;
      return;
    }
    this.arrow.visible = true;
    const dir = direction.clone().normalize();
    this.arrow.setDirection(dir);
    this.arrow.setLength(magnitude * VISUAL_SCALE, ARROW_HEAD_LEN, ARROW_HEAD_W);
  }

  detach(): void {
    if (this.arrow) {
      this.scene.remove(this.arrow);
      this.arrow.dispose();
    }
    this.arrow = null;
    this.targetObj = null;
    this.attached = false;
  }

  update(_dt: number): void {
    if (!this.arrow || !this.targetObj) return;
    this.arrow.position.set(
      this.targetObj.position.x,
      this.targetObj.position.y + ARROW_LIFT,
      this.targetObj.position.z,
    );
  }

  isAttached(): boolean {
    return this.attached;
  }
}
