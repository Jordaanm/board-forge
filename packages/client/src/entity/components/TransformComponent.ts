// Position / rotation / scale of an entity in 3D space.
// Slice #3 of planning/issues/issues--scene-graph.md.
//
// Owns a THREE.Object3D that other view-bearing components (Mesh) attach to.
// Replicates over the unreliable channel — physics-driven 60Hz updates.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { type PropertyDef } from '../propertySchema';

export interface TransformState {
  position: [number, number, number];
  rotation: [number, number, number, number];  // quaternion (x, y, z, w)
  scale:    [number, number, number];
}

export class TransformComponent extends EntityComponent<TransformState> {
  static typeId   = 'transform';
  static label    = 'Transform';
  static channel  = 'unreliable' as const;
  // Uniform-scale slider over the underlying [x, y, z] triple. Negative or
  // zero scale would invert / collapse the mesh, so the dispatcher clamps and
  // setState re-clamps.
  static propertySchema: readonly PropertyDef<TransformState>[] = [
    {
      key:   'scale',
      label: 'Scale',
      type:  'number',
      min:   0.0001,
      get:   (s) => s.scale[0],
      set:   (v) => {
        const n = Number(v);
        const safe = Number.isFinite(n) && n > 0 ? n : 1;
        return { scale: [safe, safe, safe] as [number, number, number] };
      },
    },
  ];

  // Component-owned scale invariant (issue #7 of property-schema-refactor):
  // any caller writing a non-positive scale gets clamped to 1 so the mesh
  // can't collapse or invert.
  setState(patch: Partial<TransformState>): void {
    const fixed: Partial<TransformState> = { ...patch };
    if (fixed.scale) {
      const [x, y, z] = fixed.scale;
      const sx = Number.isFinite(x) && x > 0 ? x : 1;
      const sy = Number.isFinite(y) && y > 0 ? y : 1;
      const sz = Number.isFinite(z) && z > 0 ? z : 1;
      fixed.scale = [sx, sy, sz];
    }
    super.setState(fixed);
  }

  object3d!: THREE.Object3D;

  onSpawn(ctx: SpawnContext): void {
    this.object3d = new THREE.Group();
    this.object3d.name = `entity:${this.entity.id}`;
    this.applyToObject3D();
    ctx.scene.add(this.object3d);
  }

  onDespawn(ctx: SpawnContext): void {
    ctx.scene.remove(this.object3d);
  }

  onPropertiesChanged(): void {
    if (this.object3d) this.applyToObject3D();
  }

  // Pull current pose from the underlying Object3D back into `state`. Called
  // by PhysicsComponent each tick after CANNON has integrated; the resulting
  // setState fires replication on the unreliable channel.
  syncFromObject3D(): void {
    const p = this.object3d.position;
    const q = this.object3d.quaternion;
    const s = this.object3d.scale;
    this.setState({
      position: [p.x, p.y, p.z],
      rotation: [q.x, q.y, q.z, q.w],
      scale:    [s.x, s.y, s.z],
    });
  }

  private applyToObject3D(): void {
    const [x, y, z]        = this.state.position;
    const [qx, qy, qz, qw] = this.state.rotation;
    const [sx, sy, sz]     = this.state.scale;
    this.object3d.position.set(x, y, z);
    this.object3d.quaternion.set(qx, qy, qz, qw);
    this.object3d.scale.set(sx, sy, sz);
  }
}
