// Adapter exposing a SceneGraph-compatible facade backed by the v2 entity-
// component model. Slice #3 of issues--scene-graph.md.
//
// The legacy DragController / ContextMenuController / HostReplicator /
// GuestInputHandler all read SceneEntry-shaped records (id / objectType /
// mesh / body / props). This adapter produces those records by reading from
// the underlying entities + components, so the surrounding runtime keeps
// working while v2 owns the storage + view-artefact lifecycle.
//
// Slice #4 deletes this adapter and the legacy SceneGraph entirely, cutting
// the runtime over to the v2 wire shapes.

import * as THREE from 'three';
import { type SpawnableType, type ObjectState } from '../net/SceneState';
import { type PhysicsWorld } from '../physics/PhysicsWorld';
import { TABLE_SURFACE_Y, TABLE_WIDTH, TABLE_DEPTH } from '../scene/Table';
import { type RestPose, type SceneEntry, type ISceneSystem } from '../scene/SceneGraph';
import { Scene } from './Scene';
import { type Entity } from './Entity';
import { type SpawnContext } from './EntityComponent';
import { TransformComponent } from './components/TransformComponent';
import { MeshComponent } from './components/MeshComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { ValueComponent } from './components/ValueComponent';
import { getSpawnable } from './SpawnableRegistry';
import { registerCorePrimitives } from './spawnables';

const REST_VEL_THRESHOLD = 0.05;
const REST_Y_MAX         = TABLE_SURFACE_Y + 1.4;
const REST_Y_MIN         = TABLE_SURFACE_Y - 0.05;
const FALL_OFF_Y         = TABLE_SURFACE_Y - 2.0;

interface AdapterEntry extends SceneEntry {
  entityId: string;
}

export class SceneSystemV2 implements ISceneSystem {
  private entries   = new Map<string, AdapterEntry>();
  private listeners: Array<() => void> = [];

  constructor() {
    registerCorePrimitives();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify(): void { for (const l of this.listeners) l(); }

  // ── Host: spawn ──────────────────────────────────────────────────────────
  spawn(type: SpawnableType, scene: THREE.Scene, physics: PhysicsWorld): SceneEntry {
    const def = getSpawnable(type);
    if (!def) throw new Error(`Unknown spawnable: ${type}`);

    const ctx: SpawnContext = { scene, physics };
    const entity  = Scene.spawn(type, ctx);

    const transform = entity.getComponent(TransformComponent)!;
    const phys      = entity.getComponent(PhysicsComponent);

    // Match the legacy spawn pose distribution + lift height.
    const x = (Math.random() - 0.5) * 6;
    const z = (Math.random() - 0.5) * 3;
    const mesh = entity.getComponent(MeshComponent)!;
    const [, hy] = mesh.halfExtents();
    const y = TABLE_SURFACE_Y + hy + 0.5;
    transform.setState({ position: [x, y, z], rotation: transform.state.rotation, scale: transform.state.scale });
    if (phys) {
      phys.body.position.set(x, y, z);
      phys.body.velocity.setZero();
      phys.body.angularVelocity.setZero();
    }

    const entry = this.materialise(entity, { px: x, py: y, pz: z, qx: 0, qy: 0, qz: 0, qw: 1 });
    this.entries.set(entity.id, entry);
    this.notify();
    return entry;
  }

  // ── Guest: ensure entities exist for inbound IDs ─────────────────────────
  ensureObjects(states: ObjectState[], scene: THREE.Scene): void {
    let added = false;
    for (const s of states) {
      if (this.entries.has(s.id)) continue;
      const ctx: SpawnContext = { scene, physics: null };
      const entity = Scene.spawn(s.objectType, ctx, { id: s.id });
      const transform = entity.getComponent(TransformComponent)!;
      transform.setState({
        position: [s.px, s.py, s.pz],
        rotation: [s.qx, s.qy, s.qz, s.qw],
        scale:    transform.state.scale,
      });
      const entry = this.materialise(entity, null);
      this.entries.set(s.id, entry);
      added = true;
    }
    if (added) this.notify();
  }

  // ── Lookups ──────────────────────────────────────────────────────────────
  getAll():               SceneEntry[]          { return [...this.entries.values()]; }
  getEntry(id: string):   SceneEntry | undefined { return this.entries.get(id); }

  findEntry(hit: THREE.Object3D): SceneEntry | undefined {
    let obj: THREE.Object3D | null = hit;
    while (obj) {
      for (const entry of this.entries.values()) {
        if (entry.mesh === obj) return entry;
      }
      obj = obj.parent;
    }
    return undefined;
  }

  // ── Per-tick host loop ──────────────────────────────────────────────────
  enforceTableBounds(): void {
    for (const entry of this.entries.values()) {
      if (!entry.body) continue;
      const body = entry.body;
      const px = body.position.x, py = body.position.y, pz = body.position.z;

      const onTable = py >= REST_Y_MIN && py <= REST_Y_MAX
                   && Math.abs(px) <= TABLE_WIDTH  / 2
                   && Math.abs(pz) <= TABLE_DEPTH / 2;
      const settled = body.velocity.length() + body.angularVelocity.length() < REST_VEL_THRESHOLD;
      if (onTable && settled) {
        entry.restPose = {
          px, py, pz,
          qx: body.quaternion.x, qy: body.quaternion.y,
          qz: body.quaternion.z, qw: body.quaternion.w,
        };
      }

      if (py < FALL_OFF_Y && entry.restPose) {
        body.position.set(entry.restPose.px, entry.restPose.py, entry.restPose.pz);
        body.quaternion.set(entry.restPose.qx, entry.restPose.qy, entry.restPose.qz, entry.restPose.qw);
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.wakeUp();
      }
    }
  }

  syncFromPhysics(): void {
    for (const entry of this.entries.values()) {
      const entity = Scene.getEntity(entry.entityId);
      if (!entity) continue;
      entity.getComponent(PhysicsComponent)?.syncToTransform();
    }
  }

  getPhysicsStates(): ObjectState[] {
    const out: ObjectState[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.body) continue;
      out.push({
        id:         entry.id,
        objectType: entry.objectType,
        px: entry.body.position.x,    py: entry.body.position.y,    pz: entry.body.position.z,
        qx: entry.body.quaternion.x,  qy: entry.body.quaternion.y,
        qz: entry.body.quaternion.z,  qw: entry.body.quaternion.w,
      });
    }
    return out;
  }

  // ── Despawn ──────────────────────────────────────────────────────────────
  remove(id: string, scene: THREE.Scene, physics: PhysicsWorld | null): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    Scene.despawn(entry.entityId, { scene, physics });
    this.entries.delete(id);
    this.notify();
  }

  // ── Guest: apply replicated state ────────────────────────────────────────
  applyStates(states: ObjectState[]): void {
    for (const s of states) {
      const entry = this.entries.get(s.id);
      if (!entry) continue;
      entry.mesh.position.set(s.px, s.py, s.pz);
      entry.mesh.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    }
  }

  // ── Property updates ─────────────────────────────────────────────────────
  // Maps legacy `props` keys onto component state. PRD-2 will push these
  // through the v2 wire shapes directly; until slice 4, the legacy shape
  // remains the host-runtime contract.
  updateProp(id: string, key: string, value: unknown): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const entity = Scene.getEntity(entry.entityId);
    if (!entity) return;
    this.applyPropToEntity(entity, key, value);
    entry.props[key] = value;
    this.notify();
  }

  applyProps(id: string, props: Record<string, unknown>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const entity = Scene.getEntity(entry.entityId);
    if (!entity) return;
    for (const [k, v] of Object.entries(props)) {
      this.applyPropToEntity(entity, k, v);
      entry.props[k] = v;
    }
    this.notify();
  }

  private applyPropToEntity(entity: Entity, key: string, value: unknown): void {
    if (key === 'name') {
      entity.name = String(value);
      return;
    }
    const mesh = entity.getComponent(MeshComponent);
    if (!mesh) return;

    if (entity.type === 'board') {
      const cur = mesh.state.size as [number, number, number];
      if (key === 'width')      mesh.setState({ size: [Number(value), cur[1], cur[2]] });
      else if (key === 'depth') mesh.setState({ size: [cur[0], cur[1], Number(value)] });
      else if (key === 'textureUrl') mesh.setState({ textureRef: String(value ?? '') });
    } else if (entity.type === 'token') {
      if (key === 'color') mesh.setState({ tint: String(value ?? '#ffffff') });
    }
  }

  // ── Internal: build the SceneEntry view over an entity ───────────────────
  private materialise(entity: Entity, restPose: RestPose | null): AdapterEntry {
    const transform = entity.getComponent(TransformComponent)!;
    const phys      = entity.getComponent(PhysicsComponent);
    return {
      entityId:   entity.id,
      id:         entity.id,
      objectType: entity.type as SpawnableType,
      mesh:       transform.object3d,
      body:       phys?.body ?? null,
      props:      derivePropsView(entity),
      restPose,
    };
  }
}

function derivePropsView(entity: Entity): Record<string, unknown> {
  const mesh  = entity.getComponent(MeshComponent);
  const value = entity.getComponent(ValueComponent);
  const props: Record<string, unknown> = { name: entity.name };

  if (entity.type === 'board' && mesh) {
    const sz = mesh.state.size as [number, number, number];
    props.width      = sz[0];
    props.depth      = sz[2];
    props.textureUrl = mesh.state.textureRef;
  } else if (entity.type === 'token' && mesh) {
    props.color = mesh.state.tint;
  } else if (entity.type === 'die' && value) {
    props.value = value.state.value;
  }
  return props;
}

