// Key directional light owned by the singleton Table entity. The light
// attaches to the THREE.Scene root with a fixed pose (matches the legacy
// fixture position) — parenting under the Table's transform would let
// scale / rotation skew the lighting.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { type PropertyDef } from '../propertySchema';
import { createKeyLight, applyKeyLightProp } from '../../scene/KeyLight';

export interface LightingState {
  // Renamed from `keyColor` in issue #4 of property-schema-refactor — schema
  // entry now binds directly without a cosmetic mismatch.
  color:     string;
  intensity: number;
}

export class LightingComponent extends EntityComponent<LightingState> {
  static typeId = 'lighting';
  static label  = 'Light';
  static propertySchema: readonly PropertyDef<LightingState>[] = [
    { key: 'color',     label: 'Color',     type: 'color' },
    { key: 'intensity', label: 'Intensity', type: 'number', min: 0 },
  ];

  light!:       THREE.DirectionalLight;
  private root: THREE.Scene | null = null;

  onSpawn(ctx: SpawnContext): void {
    this.light = createKeyLight({
      color:     this.state.color,
      intensity: this.state.intensity,
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
    if (changed.color     !== undefined) applyKeyLightProp(this.light, 'color',     changed.color);
    if (changed.intensity !== undefined) applyKeyLightProp(this.light, 'intensity', changed.intensity);
  }

  // Component owns its own invariant — intensity is non-negative regardless
  // of caller (issue #7 of property-schema-refactor).
  setState(patch: Partial<LightingState>): void {
    const clamped: Partial<LightingState> = { ...patch };
    if (typeof clamped.intensity === 'number' && clamped.intensity < 0) {
      clamped.intensity = 0;
    }
    super.setState(clamped);
  }
}
