// Position / rotation / scale of an entity in 3D space.
// Slice #3 of planning/issues/issues--scene-graph.md.
//
// Owns a THREE.Object3D that other view-bearing components (Mesh) attach to.
// Replicates over the unreliable channel — physics-driven 60Hz updates.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';

export interface TransformState {
  position: [number, number, number];
  rotation: [number, number, number, number];  // quaternion (x, y, z, w)
  scale:    [number, number, number];
}

export class TransformComponent extends EntityComponent<TransformState> {
  static typeId   = 'transform';
  static channel  = 'unreliable' as const;

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
