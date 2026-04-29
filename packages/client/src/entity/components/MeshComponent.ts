// 3D mesh / texture for an entity. Slice #3 of issues--scene-graph.md.
//
// Resolves `meshRef`:
//   - 'prim:cube'   → a unit cube scaled by `size` (scalar = uniform; tuple = [w,h,d])
//   - 'prim:meeple' → capsule + sphere group (matches the legacy Token shape)
//   - any URL       → reserved for slice-4+ (no asset loader yet)
//
// `textureRef` is a URL (empty = none). `tint` is a CSS colour applied to the
// material — pragmatic extension for slice 3 so the token's blue colour can
// round-trip without introducing a token-specific component.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';

export type MeshSize = number | [number, number, number];

export interface MeshState {
  meshRef:    string;
  textureRef: string;
  tint:       string;
  size:       MeshSize;
}

export class MeshComponent extends EntityComponent<MeshState> {
  static typeId   = 'mesh';
  static requires = ['transform'] as const;

  group!: THREE.Group;

  onSpawn(_ctx: SpawnContext): void {
    const transform = this.entity.getComponent(TransformComponent)!;
    this.group = new THREE.Group();
    this.rebuild();
    transform.object3d.add(this.group);
  }

  onDespawn(_ctx: SpawnContext): void {
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeGroup(this.group);
  }

  onPropertiesChanged(changed: Partial<MeshState>): void {
    if (!this.group) return;
    if (changed.meshRef !== undefined || changed.size !== undefined) {
      this.rebuild();
    } else if (changed.textureRef !== undefined || changed.tint !== undefined) {
      this.applyMaterialAttributes();
    }
  }

  // Half-extents in world units, for PhysicsComponent to derive a hitbox.
  halfExtents(): [number, number, number] {
    return halfExtentsFor(this.state.meshRef, this.state.size);
  }

  meshKind(): 'cube' | 'meeple' | 'unknown' {
    if (this.state.meshRef === 'prim:cube')   return 'cube';
    if (this.state.meshRef === 'prim:meeple') return 'meeple';
    return 'unknown';
  }

  private rebuild(): void {
    disposeGroup(this.group);
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    const built = buildMesh(this.state.meshRef, this.state.size);
    this.group.add(built);
    this.applyMaterialAttributes();
  }

  private applyMaterialAttributes(): void {
    const tint = this.state.tint || '#ffffff';
    const url  = this.state.textureRef || '';
    this.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material as THREE.MeshLambertMaterial;
      mat.color.set(new THREE.Color(tint));
      if (url) {
        new THREE.TextureLoader().load(url, (tex) => {
          mat.map = tex;
          mat.needsUpdate = true;
        });
      } else {
        mat.map = null;
        mat.needsUpdate = true;
      }
    });
  }
}

function buildMesh(meshRef: string, size: MeshSize): THREE.Object3D {
  if (meshRef === 'prim:cube') {
    const [w, h, d] = sizeToBox(size);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  if (meshRef === 'prim:meeple') {
    const r = (typeof size === 'number' ? size : size[0]) * 0.5;
    const totalH = (typeof size === 'number' ? size : size[1]);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const group = new THREE.Group();
    const body  = new THREE.Mesh(new THREE.CapsuleGeometry(r, totalH * 0.47, 4, 8), mat);
    body.position.y    = totalH * 0.36;
    body.castShadow    = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.85, 8, 6), mat);
    head.position.y    = totalH * 0.82;
    head.castShadow    = true;
    group.add(body, head);
    return group;
  }
  // Unknown ref — empty group; slice 4+ will plug in a real asset loader.
  return new THREE.Group();
}

function sizeToBox(size: MeshSize): [number, number, number] {
  return typeof size === 'number' ? [size, size, size] : size;
}

function halfExtentsFor(meshRef: string, size: MeshSize): [number, number, number] {
  if (meshRef === 'prim:cube') {
    const [w, h, d] = sizeToBox(size);
    return [w / 2, h / 2, d / 2];
  }
  if (meshRef === 'prim:meeple') {
    const r = (typeof size === 'number' ? size : size[0]) * 0.5;
    const h = (typeof size === 'number' ? size : size[1]);
    return [r, h / 2, r];
  }
  const [w, h, d] = sizeToBox(size);
  return [w / 2, h / 2, d / 2];
}

function disposeGroup(group: THREE.Object3D | undefined): void {
  if (!group) return;
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose?.();
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
      else mat?.dispose?.();
    }
  });
}
