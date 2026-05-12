// Snap points attached to an entity. Each point is a local-space pose +
// radius. The component owns the per-point visualization (translucent disc
// plus optional forward arrow) and a process-global Show-All toggle.
//
// Issue #2 of planning/issues--snap.md. Drop-snap algorithm consumes these in
// #3; editor numeric form lands in #4.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext, type MenuContext, type ActionContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';
import { type EditorToolItem } from '../editorTools';
import { newElementId } from './SurfaceElement';

export interface SnapPoint {
  id:           string;
  localPos:     [number, number, number];
  localYaw:     number;
  snapRotation: boolean;
  // When true, releasing onto this point also snaps the entity's Y position
  // to the point's world Y. When false (default), the entity's existing Y is
  // preserved — important for objects that are taller than the snap point's
  // host (e.g. a card snapping to a deck marker shouldn't drag a die through
  // the table).
  snapY:        boolean;
  radius:       number;
}

export interface SnapPointsState {
  points: SnapPoint[];
}

const DISC_COLOR  = 0x66dd66;
const ARROW_COLOR = 0x66dd66;

const DEFAULT_RADIUS = 0.4;

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

  // Editor numeric form (issue #4). Heading + one row per point (x/y/z/yaw/r
  // number inputs, snapRotation checkbox, delete button) + an Add button.
  // Each interactive item carries `pointId` in args so onAction can route the
  // edit to the right point without scanning the array.
  onEditorTools(ctx: MenuContext): EditorToolItem[] {
    if (!ctx.isHost) return [];
    const items: EditorToolItem[] = [{ kind: 'heading', label: 'Snap Points' }];
    for (const p of this.state.points) {
      const a = { pointId: p.id };
      items.push({
        kind:  'row',
        items: [
          { kind: 'number',  id: 'edit-x',      label: 'x',   value: p.localPos[0], args: a, step: 0.1  },
          { kind: 'number',  id: 'edit-y',      label: 'y',   value: p.localPos[1], args: a, step: 0.1  },
          { kind: 'number',  id: 'edit-z',      label: 'z',   value: p.localPos[2], args: a, step: 0.1  },
          { kind: 'number',  id: 'edit-yaw',    label: 'yaw', value: p.localYaw,    args: a, step: 0.1  },
          { kind: 'number',  id: 'edit-radius', label: 'r',   value: p.radius,      args: a, step: 0.05, min: 0 },
          { kind: 'boolean', id: 'edit-rot',    label: 'rot', value: p.snapRotation,  args: a },
          { kind: 'boolean', id: 'edit-snap-y', label: 'y',   value: p.snapY === true, args: a },
          { kind: 'button',  id: 'delete-point', label: '×',  args: a },
        ],
      });
    }
    items.push({ kind: 'button', id: 'add-point', label: 'Add Snap Point' });
    return items;
  }

  onAction(actionId: string, args: object | undefined, _ctx: ActionContext): void {
    if (actionId === 'add-point') {
      const next: SnapPoint = {
        id:           newElementId(),
        localPos:     [0, 0, 0],
        localYaw:     0,
        snapRotation: false,
        snapY:        false,
        radius:       DEFAULT_RADIUS,
      };
      this.setState({ points: [...this.state.points, next] });
      return;
    }
    const a = args as { pointId?: string; value?: unknown } | undefined;
    const pointId = a?.pointId;
    if (!pointId) return;
    if (actionId === 'delete-point') {
      this.setState({ points: this.state.points.filter(p => p.id !== pointId) });
      return;
    }
    const value = a?.value;
    const points = this.state.points.map(p => {
      if (p.id !== pointId) return p;
      switch (actionId) {
        case 'edit-x':
          return typeof value === 'number'
            ? { ...p, localPos: [value, p.localPos[1], p.localPos[2]] as [number, number, number] }
            : p;
        case 'edit-y':
          return typeof value === 'number'
            ? { ...p, localPos: [p.localPos[0], value, p.localPos[2]] as [number, number, number] }
            : p;
        case 'edit-z':
          return typeof value === 'number'
            ? { ...p, localPos: [p.localPos[0], p.localPos[1], value] as [number, number, number] }
            : p;
        case 'edit-yaw':
          return typeof value === 'number' ? { ...p, localYaw: value } : p;
        case 'edit-radius':
          return typeof value === 'number' ? { ...p, radius: Math.max(0, value) } : p;
        case 'edit-rot':
          return typeof value === 'boolean' ? { ...p, snapRotation: value } : p;
        case 'edit-snap-y':
          return typeof value === 'boolean' ? { ...p, snapY: value } : p;
        default:
          return p;
      }
    });
    if (points === this.state.points) return;
    this.setState({ points });
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
