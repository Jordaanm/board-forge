import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { type SpawnableType } from '../net/SceneState';
import { type PhysicsWorld } from '../physics/PhysicsWorld';

export interface RestPose {
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
}

export interface SceneEntry {
  id:         string;
  objectType: SpawnableType;
  mesh:       THREE.Object3D;
  body:       CANNON.Body | null;
  props:      Record<string, unknown>;
  restPose:   RestPose | null;
}

// Adapter surface consumed by the legacy DragController / GuestDragController /
// GuestInputHandler / ContextMenuController. Slices #5 and #7 rewrite those
// controllers against the Entity model and this interface goes away.
export interface ISceneSystem {
  subscribe(fn: () => void): () => void;
  getAll(): SceneEntry[];
  getEntry(id: string): SceneEntry | undefined;
  findEntry(hit: THREE.Object3D): SceneEntry | undefined;
  enforceTableBounds(): void;
  syncFromPhysics(): void;
  remove(id: string, scene: THREE.Scene, physics: PhysicsWorld | null): void;
  updateProp(id: string, key: string, value: unknown): void;
  applyProps(id: string, props: Record<string, unknown>): void;
}
