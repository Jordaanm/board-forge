// Snap points attached to an entity. Each point is a local-space pose +
// radius. The component owns the per-point visualization (translucent disc
// plus optional forward arrow) and a process-global Show-All toggle.
//
// Issue #2 of planning/issues--snap.md. Drop-snap algorithm consumes these in
// #3; editor numeric form lands in #4.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';

export interface SnapPoint {
  id:           string;
  localPos:     [number, number, number];
  localYaw:     number;
  snapRotation: boolean;
  radius:       number;
}

export interface SnapPointsState {
  points: SnapPoint[];
}

const DISC_COLOR  = 0x66dd66;
const ARROW_COLOR = 0x66dd66;

export class SnapPointsComponent extends EntityComponent<SnapPointsState> {
  static typeId   = 'snap-points';
  static label    = 'Snap Points';
  static requires = ['transform'] as const;
  static channel  = 'reliable' as const;

  // Process-global toggle. setShowAll() walks live instances. Host-only at
  // runtime — guests never flip it true, so their markers stay invisible.
  static showAll: boolean = false;
  private static liveInstances = new Set<SnapPointsComponent>();

  static setShowAll(on: boolean): void {
    SnapPointsComponent.showAll = on;
    for (const inst of SnapPointsComponent.liveInstances) {
      inst.updateVisibility();
    }
  }

  private group: THREE.Group | null = null;
  // Tracks per-point view nodes so we can rebuild incrementally when state
  // changes. Keyed by point.id.
  private pointNodes = new Map<string, THREE.Group>();

  onSpawn(_ctx: SpawnContext): void {
    const t = this.entity.getComponent(TransformComponent);
    if (!t) return;
    this.group = new THREE.Group();
    this.group.name = `snap-points:${this.entity.id}`;
    this.group.visible = SnapPointsComponent.showAll;
    t.object3d.add(this.group);
    this.rebuildAllPoints();
    SnapPointsComponent.liveInstances.add(this);
  }

  onDespawn(_ctx: SpawnContext): void {
    SnapPointsComponent.liveInstances.delete(this);
    if (this.group) {
      this.group.parent?.remove(this.group);
      this.disposeGroup(this.group);
      this.group = null;
    }
    this.pointNodes.clear();
  }

  onPropertiesChanged(changed: Partial<SnapPointsState>): void {
    if (changed.points !== undefined) this.rebuildAllPoints();
  }

  // Full rebuild on every state change. Cheap — handful of points per entity
  // and the editor edits aren't per-frame.
  private rebuildAllPoints(): void {
    if (!this.group) return;
    for (const node of this.pointNodes.values()) {
      this.disposeGroup(node);
      this.group.remove(node);
    }
    this.pointNodes.clear();
    for (const point of this.state.points) {
      const node = this.buildPointNode(point);
      this.pointNodes.set(point.id, node);
      this.group.add(node);
    }
  }

  private buildPointNode(point: SnapPoint): THREE.Group {
    const node = new THREE.Group();
    node.name  = `snap-point:${point.id}`;
    node.position.set(point.localPos[0], point.localPos[1], point.localPos[2]);
    node.rotation.set(0, point.localYaw, 0);

    // Disc lies horizontally (XZ plane). CircleGeometry's normal is +Z by
    // default; rotate -90° around X to point +Y so it lies flat on the table.
    const discGeom = new THREE.CircleGeometry(point.radius, 32);
    const discMat  = new THREE.MeshBasicMaterial({
      color:       DISC_COLOR,
      transparent: true,
      opacity:     0.35,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeom, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.userData.skipTint = true;
    this.attachRaycastGuard(disc);
    node.add(disc);

    if (point.snapRotation) {
      const arrow = buildArrow(point.radius);
      this.attachRaycastGuard(arrow);
      arrow.userData.skipTint = true;
      node.add(arrow);
    }

    return node;
  }

  // Visualization is non-raycastable on entities that already carry a primary
  // mesh — clicking through the disc onto the underlying card/die is what
  // hosts expect. For SnapMarker (no MeshComponent), the disc IS the body of
  // the entity, so it must participate in raycast when the visualization
  // group is visible (i.e. showAll is on).
  private attachRaycastGuard(obj: THREE.Mesh): void {
    const isMarkerBody = !this.entity.hasComponent(MeshComponent);
    if (!isMarkerBody) {
      obj.raycast = () => {};
      return;
    }
    const group = this.group;
    const defaultRaycast = THREE.Mesh.prototype.raycast;
    obj.raycast = function (raycaster, intersects) {
      if (!group || !group.visible) return;
      defaultRaycast.call(this, raycaster, intersects);
    };
  }

  private updateVisibility(): void {
    if (!this.group) return;
    this.group.visible = SnapPointsComponent.showAll;
  }

  private disposeGroup(g: THREE.Object3D): void {
    g.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const x of mat) x.dispose();
      else if (mat) mat.dispose();
    });
  }
}

function buildArrow(radius: number): THREE.Mesh {
  // Lightweight forward indicator along +Z (local). A flat triangle in the
  // XZ plane sized relative to the disc radius so big radii get readable
  // arrows and tiny ones don't get cluttered.
  const len   = radius * 0.9;
  const halfW = radius * 0.18;
  const shape = new THREE.Shape();
  shape.moveTo(0, len);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape);
  const mat  = new THREE.MeshBasicMaterial({
    color:       ARROW_COLOR,
    transparent: true,
    opacity:     0.85,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  // Shape sits in XY; lay it flat on XZ (normal +Y) lifted slightly above
  // the disc so it doesn't z-fight.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.001;
  return mesh;
}
