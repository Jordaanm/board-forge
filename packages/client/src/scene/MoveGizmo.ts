import * as THREE from 'three';

const ARM_LENGTH = 1.2;
const HEAD_LENGTH = 0.28;
const HEAD_WIDTH  = 0.18;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);

export class MoveGizmo {
  readonly group = new THREE.Group();
  private readonly arrows: THREE.ArrowHelper[];
  private target: THREE.Object3D | null = null;

  constructor() {
    const x = new THREE.ArrowHelper(AXIS_X, ORIGIN, ARM_LENGTH, 0xff3b3b, HEAD_LENGTH, HEAD_WIDTH);
    const y = new THREE.ArrowHelper(AXIS_Y, ORIGIN, ARM_LENGTH, 0x3bff3b, HEAD_LENGTH, HEAD_WIDTH);
    const z = new THREE.ArrowHelper(AXIS_Z, ORIGIN, ARM_LENGTH, 0x3b6bff, HEAD_LENGTH, HEAD_WIDTH);
    this.arrows = [x, y, z];

    for (const a of this.arrows) {
      // Draw on top so the gizmo isn't occluded by the target mesh.
      a.traverse((child) => {
        const mat = (child as THREE.Mesh | THREE.Line).material as THREE.Material | undefined;
        if (mat) { mat.depthTest = false; mat.transparent = true; }
        child.renderOrder = 999;
      });
      this.group.add(a);
    }
  }

  attach(mesh: THREE.Object3D) {
    this.target = mesh;
    this.update();
  }

  update() {
    if (!this.target) return;
    this.group.position.copy(this.target.position);
  }

  dispose() {
    for (const a of this.arrows) a.dispose();
    this.group.clear();
    this.target = null;
  }
}
