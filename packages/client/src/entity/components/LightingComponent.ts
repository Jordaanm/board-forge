// Key directional light owned by the singleton Table entity. The light
// attaches to the THREE.Scene root with a fixed pose (matches the legacy
// fixture position) — parenting under the Table's transform would let
// scale / rotation skew the lighting.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { createKeyLight, applyKeyLightProp } from '../../scene/KeyLight';

export interface LightingState {
  keyColor:     string;
  keyIntensity: number;
}

export class LightingComponent extends EntityComponent<LightingState> {
  static typeId = 'lighting';

  light!:       THREE.DirectionalLight;
  private root: THREE.Scene | null = null;

  onSpawn(ctx: SpawnContext): void {
    this.light = createKeyLight({
      color:     this.state.keyColor,
      intensity: this.state.keyIntensity,
    });
    this.root = ctx.scene;
    ctx.scene.add(this.light);
  }

  onDespawn(_ctx: SpawnContext): void {
    if (this.root) {
      this.root.remove(this.light);
      this.root = null;
    }
    this.light.dispose();
  }

  onPropertiesChanged(changed: Partial<LightingState>): void {
    if (!this.light) return;
    if (changed.keyColor     !== undefined) applyKeyLightProp(this.light, 'color',     changed.keyColor);
    if (changed.keyIntensity !== undefined) applyKeyLightProp(this.light, 'intensity', changed.keyIntensity);
  }
}
