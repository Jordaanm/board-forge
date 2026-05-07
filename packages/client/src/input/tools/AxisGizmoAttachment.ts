// AxisGizmoAttachment — wraps the existing MoveGizmo behind the
// ToolAttachment interface. GrabTool attaches/detaches it when its selection
// changes or its activation state flips.

import * as THREE from 'three';
import { type EntityHandle } from '../../entity/world';
import { TransformComponent } from '../../entity/components/TransformComponent';
import { TableComponent } from '../../entity/components/TableComponent';
import { type MoveGizmo } from '../../scene/MoveGizmo';
import { type ToolAttachment, type ToolContext } from './types';

export class AxisGizmoAttachment implements ToolAttachment {
  private attached = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly gizmo: MoveGizmo,
  ) {}

  attach(handle: EntityHandle, _ctx: ToolContext): void {
    // Singleton Table is locked at world origin and uneditable through the
    // gizmo — selecting it from the editor row should not present a falsely-
    // draggable axis triad in the 3D scene.
    if (handle.entity.hasComponent(TableComponent)) return;
    const obj = handle.get(TransformComponent)?.object3d;
    if (!obj) return;
    this.gizmo.attach(obj);
    if (!this.gizmo.group.parent) this.scene.add(this.gizmo.group);
    this.attached = true;
  }

  detach(): void {
    if (this.gizmo.group.parent) this.scene.remove(this.gizmo.group);
    this.gizmo.detach();
    this.attached = false;
  }

  update(_dt: number): void {
    if (this.attached) this.gizmo.update();
  }

  isAttached(): boolean {
    return this.attached;
  }
}
