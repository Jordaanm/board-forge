// 3D mesh / texture for an entity. Slice #3 of issues--scene-graph.md.
//
// Resolves `meshRef`:
//   - 'prim:cube'   → a unit cube scaled by `size` (scalar = uniform; tuple = [w,h,d])
//   - 'prim:d6'     → a chamfered cube body with pip overlays (single-material body)
//   - 'prim:meeple' → capsule + sphere group (matches the legacy Token shape)
//   - 'prim:card'   → thin box with three material slots: `face` on +Y, `back`
//                     on -Y, `side` on the four edge faces (BoxGeometry material
//                     groups remapped to a 3-material array).
//   - any URL       → reserved for slice-4+ (no asset loader yet)
//
// `textureRefs` is a slot-name → URL map. Single-material primitives read from
// the `default` slot. Multi-material primitives (e.g. `prim:card`) tag each
// child mesh's `userData.materialSlot` to route per-slot URLs to per-side
// materials. `tint` is a CSS colour applied to the material — pragmatic
// extension for slice 3 so the token's blue colour can round-trip without
// introducing a token-specific component.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EntityComponent, type SpawnContext, type MenuContext, type MenuItem, type ActionContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { assetService } from '../../assets/AssetService';

export type MeshSize = number | [number, number, number];

export interface MeshState {
  meshRef:     string;
  textureRefs: Record<string, string>;
  tint:        string;
  size:        MeshSize;
}

export class MeshComponent extends EntityComponent<MeshState> {
  static typeId   = 'mesh';
  static requires = ['transform'] as const;

  group!: THREE.Group;
  private textureUnsubs: (() => void)[] = [];

  onSpawn(_ctx: SpawnContext): void {
    const transform = this.entity.getComponent(TransformComponent)!;
    this.group = new THREE.Group();
    this.rebuild();
    this.group.visible = !this.entity.isContained;
    transform.object3d.add(this.group);
  }

  onDespawn(_ctx: SpawnContext): void {
    this.unsubAllTextures();
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeGroup(this.group);
  }

  private unsubAllTextures(): void {
    for (const u of this.textureUnsubs) u();
    this.textureUnsubs = [];
  }

  onPropertiesChanged(changed: Partial<MeshState>): void {
    if (!this.group) return;
    if (changed.meshRef !== undefined || changed.size !== undefined) {
      this.rebuild();
    } else if (changed.textureRefs !== undefined || changed.tint !== undefined) {
      this.applyMaterialAttributes();
    }
  }

  onIsContainedChanged(isContained: boolean): void {
    if (!this.group) return;
    this.group.visible = !isContained;
  }

  // Half-extents in world units, for PhysicsComponent to derive a hitbox.
  halfExtents(): [number, number, number] {
    return halfExtentsFor(this.state.meshRef, this.state.size);
  }

  meshKind(): 'cube' | 'meeple' | 'unknown' {
    if (this.state.meshRef === 'prim:cube') return 'cube';
    if (this.state.meshRef === 'prim:d6')   return 'cube';
    if (this.state.meshRef === 'prim:card') return 'cube';
    if (this.state.meshRef === 'prim:deck') return 'cube';
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
    this.unsubAllTextures();
    disposeGroup(this.group);
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    const built = buildMesh(this.state.meshRef, this.state.size);
    this.group.add(built);
    this.applyMaterialAttributes();
  }

  private applyMaterialAttributes(): void {
    this.unsubAllTextures();
    const tint  = this.state.tint || '#ffffff';
    const slots = this.state.textureRefs ?? {};

    const apply = (mat: THREE.Material, slot: string): void => {
      const lambert = mat as THREE.MeshLambertMaterial;
      lambert.color?.set(new THREE.Color(tint));
      const ref = slots[slot] || '';
      if (ref) {
        const unsub = assetService.subscribe(ref, 'image', (tex) => {
          lambert.map = tex;
          lambert.needsUpdate = true;
        });
        this.textureUnsubs.push(unsub);
      } else {
        lambert.map = null;
        lambert.needsUpdate = true;
      }
    };

    this.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      // Pip overlays own their own material — tint/texture only apply to the body.
      if (child.userData.skipTint) return;
      const meshSlot = (child.userData.materialSlot as string | undefined) ?? 'default';
      if (Array.isArray(child.material)) {
        for (const mat of child.material) {
          // Per-material skipTint (deck side stripe map keeps its procedural texture).
          if (mat.userData?.skipTint) continue;
          const matSlot = (mat.userData?.materialSlot as string | undefined) ?? meshSlot;
          apply(mat, matSlot);
        }
      } else {
        apply(child.material, meshSlot);
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
  if (meshRef === 'prim:d6')   return buildD6(size);
  if (meshRef === 'prim:card') return buildCard(size);
  if (meshRef === 'prim:deck') return buildDeck(size);
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
  if (
    meshRef === 'prim:cube' ||
    meshRef === 'prim:d6'   ||
    meshRef === 'prim:card' ||
    meshRef === 'prim:deck'
  ) {
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

// Card = thin BoxGeometry whose 6 face groups are remapped to 3 materials:
// face (+Y) → 0, back (-Y) → 1, sides (±X, ±Z) → 2. Each material carries a
// `userData.materialSlot` so applyMaterialAttributes can route per-slot URLs
// from `state.textureRefs` to the correct side. Default size matches a
// playing-card aspect (≈ 63mm × 88mm at 1 unit ≈ 1 dm); thickness is
// exaggerated to 0.01 for physics stability — real cards (~0.3mm) tunnel.
function buildCard(size: MeshSize): THREE.Object3D {
  const [w, h, d] = sizeToBox(size);
  const geometry = new THREE.BoxGeometry(w, h, d);
  // BoxGeometry creates one group per face in order +X, -X, +Y, -Y, +Z, -Z
  // with materialIndex 0..5. Remap so +Y/-Y bind to face/back materials, the
  // rest to a shared side material.
  geometry.groups[0].materialIndex = 2; // +X side
  geometry.groups[1].materialIndex = 2; // -X side
  geometry.groups[2].materialIndex = 0; // +Y face
  geometry.groups[3].materialIndex = 1; // -Y back
  geometry.groups[4].materialIndex = 2; // +Z side
  geometry.groups[5].materialIndex = 2; // -Z side

  const faceMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  faceMat.userData = { materialSlot: 'face' };
  const backMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  backMat.userData = { materialSlot: 'back' };
  const sideMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  sideMat.userData = { materialSlot: 'side' };

  const mesh = new THREE.Mesh(geometry, [faceMat, backMat, sideMat]);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

// prim:deck — like prim:card but the side material renders striped slabs (one
// per card). Stripe count derives from height: `cards.length = round(h /
// CARD_SLAB_HEIGHT)`. The side material carries `userData.skipTint` so
// applyMaterialAttributes doesn't overwrite the procedural map with a null
// when no `side` URL is set.
function buildDeck(size: MeshSize): THREE.Object3D {
  const [w, h, d] = sizeToBox(size);
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.groups[0].materialIndex = 2; // +X side
  geometry.groups[1].materialIndex = 2; // -X side
  geometry.groups[2].materialIndex = 0; // +Y face (top card)
  geometry.groups[3].materialIndex = 1; // -Y back (bottom card back)
  geometry.groups[4].materialIndex = 2; // +Z side
  geometry.groups[5].materialIndex = 2; // -Z side

  const faceMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  faceMat.userData = { materialSlot: 'face' };
  const backMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  backMat.userData = { materialSlot: 'back' };

  const stripeCount = Math.max(1, Math.round(h / 0.02));
  const sideMat = new THREE.MeshLambertMaterial({ color: 0xfafafa });
  sideMat.userData = { materialSlot: 'side', skipTint: true };
  const stripeTex = stripeTextureFor(stripeCount);
  if (stripeTex) {
    sideMat.map = stripeTex;
    sideMat.needsUpdate = true;
  }

  const mesh = new THREE.Mesh(geometry, [faceMat, backMat, sideMat]);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

const stripeTextureCache = new Map<number, THREE.Texture>();

function stripeTextureFor(stripeCount: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cached = stripeTextureCache.get(stripeCount);
  if (cached) return cached;

  const SIZE = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#202020';
  for (let i = 1; i < stripeCount; i++) {
    const y = Math.floor((SIZE * i) / stripeCount);
    ctx.fillRect(0, y, SIZE, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  stripeTextureCache.set(stripeCount, tex);
  return tex;
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
