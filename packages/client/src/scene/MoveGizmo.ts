import * as THREE from 'three';

const ARM_LENGTH    = 1.2;
const HEAD_LENGTH   = 0.28;
const HEAD_WIDTH    = 0.18;
const PICKER_RADIUS = 0.14;
// Start pickers past the object center so a click on the body itself
// doesn't get captured as an axis grab.
const PICKER_START  = 0.4;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);

export type GizmoAxis = 'x' | 'y' | 'z';

export class MoveGizmo {
  readonly group = new THREE.Group();
  private readonly arrows:  THREE.ArrowHelper[];
  private readonly pickers: THREE.Mesh[];
  private readonly pickerGeom: THREE.CylinderGeometry;
  private readonly pickerMat:  THREE.MeshBasicMaterial;
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

    const pickerLen = ARM_LENGTH - PICKER_START;
    this.pickerGeom = new THREE.CylinderGeometry(PICKER_RADIUS, PICKER_RADIUS, pickerLen, 8);
    this.pickerMat  = new THREE.MeshBasicMaterial();
    this.pickerMat.visible = false;

    const mid = PICKER_START + pickerLen / 2;
    const px = new THREE.Mesh(this.pickerGeom, this.pickerMat);
    px.rotation.z = -Math.PI / 2;
    px.position.x = mid;
    px.userData.gizmoAxis = 'x';

    const py = new THREE.Mesh(this.pickerGeom, this.pickerMat);
    py.position.y = mid;
    py.userData.gizmoAxis = 'y';

    const pz = new THREE.Mesh(this.pickerGeom, this.pickerMat);
    pz.rotation.x = Math.PI / 2;
    pz.position.z = mid;
    pz.userData.gizmoAxis = 'z';

    this.pickers = [px, py, pz];
    for (const p of this.pickers) this.group.add(p);
  }

  attach(mesh: THREE.Object3D) {
    this.target = mesh;
    this.update();
  }

  detach() { this.target = null; }

  hasTarget(): boolean { return this.target !== null; }

  getTarget(): THREE.Object3D | null { return this.target; }

  update() {
    if (!this.target) return;
    this.group.position.copy(this.target.position);
  }

  pickAxis(raycaster: THREE.Raycaster): GizmoAxis | null {
    if (!this.target || !this.group.parent) return null;
    const hits = raycaster.intersectObjects(this.pickers, false);
    if (hits.length === 0) return null;
    return hits[0].object.userData.gizmoAxis as GizmoAxis;
  }

  dispose() {
    for (const a of this.arrows) a.dispose();
    this.pickerGeom.dispose();
    this.pickerMat.dispose();
    this.group.clear();
    this.target = null;
  }
}
