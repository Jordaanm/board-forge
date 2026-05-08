// 3D mesh / texture for an entity. Slice #3 of issues--scene-graph.md.
//
// Resolves `meshRef`:
//   - 'prim:cube'   → a unit cube scaled by `size` (scalar = uniform; tuple = [w,h,d])
//   - 'prim:d6'     → a chamfered cube body with pip overlays (single-material body)
//   - 'prim:d20'    → an icosahedron body with numbered triangular face overlays
//   - 'prim:meeple' → capsule + sphere group (matches the legacy Token shape)
//   - 'prim:plane'  → single-quad PlaneGeometry in the local XY plane (normal
//                     +Z), one `default` material slot. UVs flipped along V so
//                     canvas top-left renders at the visual top when viewed
//                     from +Z. Width = size[0], height = size[2]; size[1]
//                     ignored. Used as the substrate for SurfaceComponent.
//   - 'prim:card'   → thin box with three material slots: `face` on +Y, `back`
//                     on -Y, `side` on the four edge faces (BoxGeometry material
//                     groups remapped to a 3-material array).
//   - 'custom:*' or
//     a raw URL    → loaded as a GLTF/GLB via AssetService's model loader.
//                    Issue #9 of issues--asset-registry.md.
//
// `textureRefs` is a slot-name → URL map. Single-material primitives read from
// the `default` slot. Multi-material primitives (e.g. `prim:card`) tag each
// child mesh's `userData.materialSlot` to route per-slot URLs to per-side
// materials. `tint` is a CSS colour applied to the material — pragmatic
// extension for slice 3 so the token's blue colour can round-trip without
// introducing a token-specific component. Tint and textureRefs are NOT
// applied to loaded GLTF models — those keep their authored materials.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EntityComponent, type SpawnContext, type MenuContext, type MenuItem, type ActionContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { assetService } from '../../assets/AssetService';
import {
  D20_VERTICES,
  D20_FACES,
  D20_FACE_MAP,
  D20_BOUNDING_SPHERE_RADIUS,
} from '../../dice/d20';

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
  private modelUnsub: (() => void) | null = null;

  onSpawn(_ctx: SpawnContext): void {
    const transform = this.entity.getComponent(TransformComponent)!;
    this.group = new THREE.Group();
    this.rebuild();
    this.group.visible = !this.entity.isContained;
    transform.object3d.add(this.group);
  }

  onDespawn(_ctx: SpawnContext): void {
    this.unsubAllTextures();
    this.unsubModel();
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeGroup(this.group);
  }

  private unsubAllTextures(): void {
    for (const u of this.textureUnsubs) u();
    this.textureUnsubs = [];
  }

  private unsubModel(): void {
    if (this.modelUnsub) { this.modelUnsub(); this.modelUnsub = null; }
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

  // Local-space offset of the visible mesh from the entity origin. Most
  // primitives are centred (returns [0, 0, 0]); the Table primitives are
  // authored with their top surface at local y=0, so the body needs the same
  // downward shift to keep the hitbox flush with the visible top.
  meshOffset(): [number, number, number] {
    if (this.state.meshRef === 'prim:table-rect' || this.state.meshRef === 'prim:table-circle') {
      const [, h] = sizeToBox(this.state.size);
      return [0, -h / 2, 0];
    }
    return [0, 0, 0];
  }

  meshKind(): 'cube' | 'meeple' | 'cylinder' | 'icosahedron' | 'unknown' {
    if (this.state.meshRef === 'prim:cube') return 'cube';
    if (this.state.meshRef === 'prim:d6')   return 'cube';
    if (this.state.meshRef === 'prim:d20')  return 'icosahedron';
    if (this.state.meshRef === 'prim:card') return 'cube';
    if (this.state.meshRef === 'prim:deck') return 'cube';
    if (this.state.meshRef === 'prim:plane') return 'cube';
    if (this.state.meshRef === 'prim:table-rect')   return 'cube';
    if (this.state.meshRef === 'prim:table-circle') return 'cylinder';
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
    this.unsubModel();
    disposeGroup(this.group);
    while (this.group.children.length) this.group.remove(this.group.children[0]);

    const ref = this.state.meshRef;
    if (isPrimRef(ref) || ref === '') {
      const built = buildMesh(ref, this.state.size);
      this.group.add(built);
      this.applyMaterialAttributes();
      return;
    }

    // Non-primitive ref: subscribe through AssetService for an Object3D.
    // The listener fires immediately with a placeholder cube (pending) and
    // again once the GLTF resolves. Each transition swaps the group's child.
    this.modelUnsub = assetService.subscribe(ref, 'model', (obj, _status) => {
      disposeGroup(this.group);
      while (this.group.children.length) this.group.remove(this.group.children[0]);
      const clone = obj.clone(true);
      this.group.add(clone);
    });
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
          // SurfaceComponent owns this slot's `map`; do not overwrite from
          // textureRefs/tint flow.
          if (mat.userData?.surfaceOwned) continue;
          const matSlot = (mat.userData?.materialSlot as string | undefined) ?? meshSlot;
          apply(mat, matSlot);
        }
      } else {
        if ((child.material as THREE.Material).userData?.surfaceOwned) return;
        apply(child.material, meshSlot);
      }
    });
  }
}

function isPrimRef(ref: string): boolean {
  return ref.startsWith('prim:');
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
  if (meshRef === 'prim:d20')  return buildD20(size);
  if (meshRef === 'prim:card') return buildCard(size);
  if (meshRef === 'prim:deck') return buildDeck(size);
  if (meshRef === 'prim:plane') return buildPlane(size);
  if (meshRef === 'prim:table-rect')   return buildTableRect(size);
  if (meshRef === 'prim:table-circle') return buildTableCircle(size);
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
    meshRef === 'prim:deck' ||
    meshRef === 'prim:table-rect'
  ) {
    const [w, h, d] = sizeToBox(size);
    return [w / 2, h / 2, d / 2];
  }
  if (meshRef === 'prim:d20') {
    // Bounding-sphere radius in each axis — overestimates the true AABB
    // (which is 0.851× this) but gives PhysicsComponent a single radius value
    // for the ConvexPolyhedron build, and is harmless for spawn placement.
    const r = (typeof size === 'number' ? size : size[0]) / 2;
    return [r, r, r];
  }
  if (meshRef === 'prim:plane') {
    // Plane lies in local XY: x-extent w/2, y-extent d/2, z-extent 0.
    const [w, , d] = sizeToBox(size);
    return [w / 2, d / 2, 0];
  }
  if (meshRef === 'prim:table-circle') {
    // size = [diameter, height, diameter] for a cylinder authored to match
    // the rect's bounding box conventions.
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

// prim:plane — single-quad PlaneGeometry lying in local XY with normal +Z.
// Width = size[0], height (in-plane) = size[2]; size[1] (thickness) ignored
// since a plane has none. UVs are flipped along V so a Canvas2D drawing whose
// (0, 0) origin is its top-left lands at the visual top-left when the plane
// is viewed from +Z. Single 'default' material slot — applyMaterialAttributes
// routes textureRefs.default to the material map.
function buildPlane(size: MeshSize): THREE.Object3D {
  const [w, , d] = sizeToBox(size);
  const geometry = new THREE.PlaneGeometry(w, d);
  const uv  = geometry.attributes.uv as THREE.BufferAttribute;
  const arr = uv.array as Float32Array;
  for (let i = 1; i < arr.length; i += 2) arr[i] = 1 - arr[i];
  uv.needsUpdate = true;
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

// prim:table-rect — flat box authored with its top surface at local y=0 so
// the entity's locked-at-origin transform places the play surface at world
// y=0 regardless of uniform scale.
function buildTableRect(size: MeshSize): THREE.Object3D {
  const [w, h, d] = sizeToBox(size);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  mesh.position.y    = -h / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// prim:table-circle — flat cylinder authored with its top surface at local
// y=0. `size` is consumed as [diameter, thickness, diameter] so the bounding
// half-extents helper can treat all four flat primitives identically.
function buildTableCircle(size: MeshSize): THREE.Object3D {
  const [w, h, _d] = sizeToBox(size);
  const radius = w / 2;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, h, 64),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  mesh.position.y    = -h / 2;
  mesh.receiveShadow = true;
  return mesh;
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

// D20 = icosahedron body (single-material) plus 20 transparent triangular
// overlays carrying numbered face textures. Geometry data is shared with
// PhysicsComponent so the mesh and the ConvexPolyhedron hull line up exactly.
function buildD20(size: MeshSize): THREE.Object3D {
  const s     = typeof size === 'number' ? size : size[0];
  const scale = (s / 2) / D20_BOUNDING_SPHERE_RADIUS;

  const group = new THREE.Group();

  const positions: number[] = [];
  const normals:   number[] = [];
  const centroids: Array<[number, number, number]> = [];
  for (const face of D20_FACES) {
    const va = D20_VERTICES[face[0]];
    const vb = D20_VERTICES[face[1]];
    const vc = D20_VERTICES[face[2]];
    let nx = (vb[1] - va[1]) * (vc[2] - va[2]) - (vb[2] - va[2]) * (vc[1] - va[1]);
    let ny = (vb[2] - va[2]) * (vc[0] - va[0]) - (vb[0] - va[0]) * (vc[2] - va[2]);
    let nz = (vb[0] - va[0]) * (vc[1] - va[1]) - (vb[1] - va[1]) * (vc[0] - va[0]);
    const nLen = Math.hypot(nx, ny, nz);
    nx /= nLen; ny /= nLen; nz /= nLen;
    for (const v of [va, vb, vc]) {
      positions.push(v[0] * scale, v[1] * scale, v[2] * scale);
      normals.push(nx, ny, nz);
    }
    centroids.push([
      ((va[0] + vb[0] + vc[0]) / 3) * scale,
      ((va[1] + vb[1] + vc[1]) / 3) * scale,
      ((va[2] + vb[2] + vc[2]) / 3) * scale,
    ]);
  }
  const bodyGeom = new THREE.BufferGeometry();
  bodyGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bodyGeom.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  const body = new THREE.Mesh(bodyGeom, new THREE.MeshLambertMaterial({ color: 0xffffff }));
  body.castShadow    = true;
  body.receiveShadow = true;
  group.add(body);

  const INSET  = 0.45;   // shrink each label triangle toward its centroid
  const OUTSET = 0.001;  // sub-mm push along the face normal to dodge z-fighting
  for (let i = 0; i < D20_FACES.length; i++) {
    const tex = numberTextureFor(D20_FACE_MAP[i].value);
    if (!tex) continue;
    const face = D20_FACES[i];
    const c    = centroids[i];
    const cLen = Math.hypot(c[0], c[1], c[2]);
    const ox   = (c[0] / cLen) * OUTSET;
    const oy   = (c[1] / cLen) * OUTSET;
    const oz   = (c[2] / cLen) * OUTSET;

    const lerp = (idx: number): [number, number, number] => {
      const v  = D20_VERTICES[idx];
      const sx = v[0] * scale, sy = v[1] * scale, sz = v[2] * scale;
      return [
        sx + (c[0] - sx) * INSET + ox,
        sy + (c[1] - sy) * INSET + oy,
        sz + (c[2] - sz) * INSET + oz,
      ];
    };
    const pa = lerp(face[0]);
    const pb = lerp(face[1]);
    const pc = lerp(face[2]);

    const planeGeom = new THREE.BufferGeometry();
    planeGeom.setAttribute('position', new THREE.Float32BufferAttribute([
      pa[0], pa[1], pa[2],
      pb[0], pb[1], pb[2],
      pc[0], pc[1], pc[2],
    ], 3));
    // UV triangle (0,0)-(1,0)-(0.5,1); centroid at (0.5, 0.333). The number
    // texture draws its glyph at that UV so it lands on the face centre.
    planeGeom.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      0.5, 1,
    ], 2));
    planeGeom.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const plane = new THREE.Mesh(planeGeom, mat);
    plane.userData.skipTint = true;
    group.add(plane);
  }

  return group;
}

const numberTextureCache = new Map<number, THREE.Texture>();

function numberTextureFor(value: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cached = numberTextureCache.get(value);
  if (cached) return cached;

  const SIZE   = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle    = '#1a1a1a';
  ctx.font         = 'bold 96px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  // Draw at the UV-triangle centroid: u=0.5, v=0.333 → canvas (0.5, 1-0.333).
  const cxPx = SIZE * 0.5;
  const cyPx = SIZE * (1 - 1 / 3);
  ctx.fillText(String(value), cxPx, cyPx);
  // Underline 6 and 9 so the orientation reads correctly when settled.
  if (value === 6 || value === 9) {
    const w = SIZE * 0.18;
    ctx.fillRect(cxPx - w / 2, cyPx + 44, w, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  numberTextureCache.set(value, tex);
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
