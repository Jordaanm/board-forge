import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { type SpawnableType } from '../net/SceneState';

export type ActionDef      = { id: string; label: string };
export type PropertyDef    = { key: string; label: string; type: 'number' | 'string' | 'color' };
export type PropertySchema = PropertyDef[];

// Minimal shape needed by applyProp — avoids circular import with SceneGraph
export interface PropTarget {
  mesh:  THREE.Object3D;
  props: Record<string, unknown>;
}

export interface ObjectTypeDef {
  type: SpawnableType;
  label: string;
  isThrowable: boolean;
  spawnHeight: number;
  defaultProps: Record<string, unknown>;
  propertySchema: PropertySchema;
  actions: ActionDef[];
  createMesh(): THREE.Object3D;
  createBody(): CANNON.Body | null;
  applyProp(target: PropTarget, key: string, value: unknown): void;
}

// ── Board ─────────────────────────────────────────────────────────────────
const BOARD_W = 4, BOARD_D = 3, BOARD_T = 0.05;

export const BoardTypeDef: ObjectTypeDef = {
  type: 'board',
  label: 'Board',
  isThrowable: true,
  spawnHeight: BOARD_T / 2,
  defaultProps: { width: BOARD_W, depth: BOARD_D, textureUrl: '' },
  propertySchema: [
    { key: 'width',      label: 'Width',   type: 'number' },
    { key: 'depth',      label: 'Depth',   type: 'number' },
    { key: 'textureUrl', label: 'Texture', type: 'string' },
  ],
  actions: [],
  createMesh() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W, BOARD_T, BOARD_D),
      new THREE.MeshLambertMaterial({ color: 0x2d5a27 }),
    );
    mesh.receiveShadow = true;
    return mesh;
  },
  createBody() {
    return new CANNON.Body({
      mass: 0.5,
      linearDamping: 0.3,
      angularDamping: 0.6,
      shape: new CANNON.Box(new CANNON.Vec3(BOARD_W / 2, BOARD_T / 2, BOARD_D / 2)),
    });
  },
  applyProp(target, key, value) {
    const w = (target.props['width']  as number | undefined) ?? BOARD_W;
    const d = (target.props['depth']  as number | undefined) ?? BOARD_D;
    if (key === 'width' || key === 'depth') {
      target.mesh.scale.set(w / BOARD_W, 1, d / BOARD_D);
    } else if (key === 'textureUrl') {
      const mat = (target.mesh as THREE.Mesh).material as THREE.MeshLambertMaterial;
      if (value && typeof value === 'string') {
        new THREE.TextureLoader().load(value, (tex) => {
          mat.map = tex;
          mat.needsUpdate = true;
        });
      } else {
        mat.map = null;
        mat.needsUpdate = true;
      }
    }
  },
};

// ── Die (D6) ──────────────────────────────────────────────────────────────
export const DIE_SIZE = 0.7;

export const DieTypeDef: ObjectTypeDef = {
  type: 'die',
  label: 'Die (D6)',
  isThrowable: true,
  spawnHeight: DIE_SIZE / 2,
  defaultProps: {},
  propertySchema: [],
  actions: [{ id: 'roll', label: 'Roll' }],
  createMesh() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE),
      new THREE.MeshLambertMaterial({ color: 0xfafafa }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
  createBody() {
    return new CANNON.Body({
      mass: 0.2,
      linearDamping: 0.3,
      angularDamping: 0.5,
      shape: new CANNON.Box(new CANNON.Vec3(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)),
    });
  },
  applyProp() {},
};

// ── Token (Meeple) ────────────────────────────────────────────────────────
const MEEPLE_R = 0.25;
const MEEPLE_H = 0.75;

export const TokenTypeDef: ObjectTypeDef = {
  type: 'token',
  label: 'Token',
  isThrowable: true,
  spawnHeight: MEEPLE_H / 2,
  defaultProps: { color: '#2266cc' },
  propertySchema: [
    { key: 'color', label: 'Color', type: 'color' },
  ],
  actions: [],
  createMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x2266cc });

    const bodyMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(MEEPLE_R, 0.35, 4, 8),
      mat,
    );
    bodyMesh.position.y = MEEPLE_H * 0.36;
    bodyMesh.castShadow = true;

    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(MEEPLE_R * 0.85, 8, 6),
      mat,
    );
    headMesh.position.y = MEEPLE_H * 0.82;
    headMesh.castShadow = true;

    group.add(bodyMesh, headMesh);
    return group;
  },
  createBody() {
    return new CANNON.Body({
      mass: 0.1,
      linearDamping: 0.4,
      angularDamping: 0.8,
      shape: new CANNON.Cylinder(MEEPLE_R, MEEPLE_R, MEEPLE_H, 12),
    });
  },
  applyProp(target, key, value) {
    if (key !== 'color') return;
    const color = new THREE.Color(value as string);
    target.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshLambertMaterial).color.set(color);
      }
    });
  },
};

// ── Registry ─────────────────────────────────────────────────────────────
export const OBJECT_TYPE_REGISTRY: Record<SpawnableType, ObjectTypeDef> = {
  board: BoardTypeDef,
  die:   DieTypeDef,
  token: TokenTypeDef,
};

// ── Die face detection ────────────────────────────────────────────────────
const _qInv    = new THREE.Quaternion();
const _localUp = new THREE.Vector3();

export function getDieFace(qx: number, qy: number, qz: number, qw: number): number {
  _qInv.set(-qx, -qy, -qz, qw);
  _localUp.set(0, 1, 0).applyQuaternion(_qInv);

  const ax = Math.abs(_localUp.x), ay = Math.abs(_localUp.y), az = Math.abs(_localUp.z);
  if (ay >= ax && ay >= az) return _localUp.y > 0 ? 1 : 6;
  if (ax >= ay && ax >= az) return _localUp.x > 0 ? 2 : 5;
  return _localUp.z > 0 ? 3 : 4;
}
