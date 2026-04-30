// Host-side scene system backed by the v2 entity-component model. Implements
// the legacy ISceneSystem facade so DragController / GuestInputHandler /
// ContextMenuController keep working until slices #5 and #7 rewrite them
// against the Entity model directly.

import * as THREE from 'three';
import { type SpawnableType } from '../net/SceneState';
import { type PhysicsWorld } from '../physics/PhysicsWorld';
import { TABLE_SURFACE_Y, TABLE_WIDTH, TABLE_DEPTH } from '../scene/Table';
import { type RestPose, type SceneEntry, type ISceneSystem } from '../scene/SceneSystem';
import { Scene, entityToSerialized } from './Scene';
import { type Entity } from './Entity';
import { type SpawnContext } from './EntityComponent';
import { TransformComponent } from './components/TransformComponent';
import { MeshComponent } from './components/MeshComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { ValueComponent } from './components/ValueComponent';
import { getSpawnable } from './SpawnableRegistry';
import { registerCorePrimitives } from './spawnables';
import { type HostReplicatorV2 } from './HostReplicatorV2';

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
  private replicator: HostReplicatorV2 | null = null;

  constructor() {
    registerCorePrimitives();
  }

  // Host wires its HostReplicatorV2 in so spawn / despawn / prop changes get
  // pushed onto the wire. Guests leave it null.
  setReplicator(r: HostReplicatorV2 | null): void {
    this.replicator = r;
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
    const mesh      = entity.getComponent(MeshComponent)!;

    const x = (Math.random() - 0.5) * 6;
    const z = (Math.random() - 0.5) * 3;
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

    if (this.replicator) this.replicator.enqueueEntitySpawn(entityToSerialized(entity));
    return entry;
  }

  // ── Host or Guest: rebuild SceneEntry views for entities that the Scene
  // already knows about but this adapter hasn't materialised yet. Called on
  // the guest after applySceneMessage processes an entity-spawn — the entity
  // exists in Scene but has no SceneEntry view here.
  syncFromScene(): void {
    let added = false;
    for (const entity of Scene.all()) {
      if (this.entries.has(entity.id)) continue;
      const transform = entity.getComponent(TransformComponent);
      if (!transform || !transform.object3d) continue;
      this.entries.set(entity.id, this.materialise(entity, null));
      added = true;
    }
    let removed = false;
    for (const id of [...this.entries.keys()]) {
      if (!Scene.has(id)) {
        this.entries.delete(id);
        removed = true;
      }
    }
    if (added || removed) this.notify();
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

  // ── Despawn ──────────────────────────────────────────────────────────────
  remove(id: string, scene: THREE.Scene, physics: PhysicsWorld | null): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const removed = Scene.despawn(entry.entityId, { scene, physics });
    this.entries.delete(id);
    this.notify();
    if (this.replicator && removed.length > 0) this.replicator.enqueueDespawn(removed);
  }

  // ── Property updates ─────────────────────────────────────────────────────
  // Maps legacy `props` keys (consumed by EditorPanel) onto component state +
  // entity-level fields. Slice #7 collapses these into a single component-
  // driven path via invoke-action; for now this is the editor's write surface.
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
      if (this.replicator) {
        this.replicator.enqueueEntityPatch(entity.id, { name: entity.name });
      }
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
