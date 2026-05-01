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
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EntityComponent, type SpawnContext, type MenuContext, type MenuItem, type ActionContext } from '../EntityComponent';
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
    if (this.state.meshRef === 'prim:cube') return 'cube';
    if (this.state.meshRef === 'prim:d6')   return 'cube';
    if (this.state.meshRef === 'prim:meeple') return 'meeple';
    return 'unknown';
  }

  onContextMenu(_ctx: MenuContext): MenuItem[] {
    return [{ kind: 'colorpicker', id: 'set-tint', label: 'Tint', value: this.state.tint || '#ffffff' }];
  }

  onAction(actionId: string, args: object | undefined, _ctx: ActionContext): void {
    if (actionId !== 'set-tint') return;
    const value = (args as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') return;
    this.setState({ tint: value });
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
      // Pip overlays own their own material — tint/texture only apply to the body.
      if (child.userData.skipTint) return;
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
  if (meshRef === 'prim:d6') return buildD6(size);
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
  if (meshRef === 'prim:cube' || meshRef === 'prim:d6') {
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

// D6 = chamfered cube body (RoundedBoxGeometry) plus six transparent pip
// overlays. The body picks up tint via applyMaterialAttributes; pip planes
// carry `userData.skipTint` so tint changes don't recolour the dots.
function buildD6(size: MeshSize): THREE.Object3D {
  const s      = typeof size === 'number' ? size : size[0];
  const radius = s * 0.08;

  const group = new THREE.Group();
  const body  = new THREE.Mesh(
    new RoundedBoxGeometry(s, s, s, 4, radius),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  body.castShadow    = true;
  body.receiveShadow = true;
  group.add(body);

  const half   = s / 2;
  const offset = half + 0.001; // sub-mm outset to dodge z-fighting
  // [pip count, position, rotation] — opposite faces sum to 7
  const faces: ReadonlyArray<readonly [number, [number, number, number], [number, number, number]]> = [
    [1, [0,  offset, 0], [-Math.PI / 2, 0, 0]],
    [6, [0, -offset, 0], [ Math.PI / 2, 0, 0]],
    [2, [0, 0,  offset], [0, 0, 0]],
    [5, [0, 0, -offset], [0, Math.PI, 0]],
    [3, [ offset, 0, 0], [0,  Math.PI / 2, 0]],
    [4, [-offset, 0, 0], [0, -Math.PI / 2, 0]],
  ];

  const planeSize = s * 0.85;
  for (const [count, pos, rot] of faces) {
    const tex = pipTextureFor(count);
    if (!tex) continue;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), mat);
    plane.position.set(pos[0], pos[1], pos[2]);
    plane.rotation.set(rot[0], rot[1], rot[2]);
    plane.userData.skipTint = true;
    group.add(plane);
  }

  return group;
}

const PIP_POSITIONS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

const pipTextureCache = new Map<number, THREE.Texture>();

function pipTextureFor(count: number): THREE.Texture | null {
  // Tests run in node — no DOM, no canvas. Skip the overlay; physics + body
  // still build correctly so spawn/round-trip tests are unaffected.
  if (typeof document === 'undefined') return null;
  const cached = pipTextureCache.get(count);
  if (cached) return cached;

  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#1a1a1a';
  const r = SIZE * 0.08;
  for (const [x, y] of PIP_POSITIONS[count]) {
    ctx.beginPath();
    ctx.arc(x * SIZE, y * SIZE, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  pipTextureCache.set(count, tex);
  return tex;
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
