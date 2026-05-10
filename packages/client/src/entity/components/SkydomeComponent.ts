// Skydome — large inverted sphere rendered behind everything else. Owned by
// the singleton Table entity but the mesh attaches to the THREE.Scene root
// (not to the Table's TransformComponent.object3d) so a scaled / rotated
// Table doesn't warp the sky.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { type PropertyDef } from '../propertySchema';
import { createSkydome, applySkydomeProp } from '../../scene/Skydome';

export interface SkydomeState {
  textureUrl: string;
}

export class SkydomeComponent extends EntityComponent<SkydomeState> {
  static typeId = 'skydome';
  static label  = 'Sky';
  static propertySchema: readonly PropertyDef<SkydomeState>[] = [
    { key: 'textureUrl', label: 'Texture', type: 'asset:image' },
  ];

  mesh!:        THREE.Mesh;
  private root: THREE.Scene | null = null;

  onSpawn(ctx: SpawnContext): void {
    this.mesh = createSkydome({ textureUrl: this.state.textureUrl });
    this.root = ctx.scene;
    ctx.scene.add(this.mesh);
  }

  onDespawn(_ctx: SpawnContext): void {
    // Empty-string apply releases the AssetService subscription and disposes
    // the cloned equirectangular texture before we drop the mesh.
    applySkydomeProp(this.mesh, 'textureUrl', '');
    if (this.root) {
      this.root.remove(this.mesh);
      this.root = null;
    }
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  onPropertiesChanged(changed: Partial<SkydomeState>): void {
    if (!this.mesh) return;
    if (changed.textureUrl !== undefined) {
      applySkydomeProp(this.mesh, 'textureUrl', changed.textureUrl);
    }
  }
}
