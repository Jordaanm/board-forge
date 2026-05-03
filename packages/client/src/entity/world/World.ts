// World — issue #1 of issues--arch.md.
//
// Composes the existing Scene / HostReplicatorV2 / inbound dispatch behind a
// single facade so subsequent slices can migrate ThreeCanvas / DragController /
// EditorPanel call sites one at a time. Each World owns its own SceneImpl
// instance — host and guest can co-exist in one process for boundary tests.
//
// `EntityComponent.hostReplicator` is still a process-global static. World
// sets it on host construction and clears on dispose. Tests with multiple
// hosts in one process collide there; issue #6 deletes the static.

import * as THREE from 'three';
import { type Entity } from '../Entity';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { SceneImpl, entityToSerialized, type EntitySerialized } from '../Scene';
import { HostReplicatorV2 } from '../HostReplicatorV2';
import { type SceneMessage, type EntityFieldsPartial } from '../wire';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { MeshComponent } from '../components/MeshComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { TABLE_SURFACE_Y, TABLE_WIDTH, TABLE_DEPTH } from '../../scene/Table';
import { EntityHandleImpl } from './EntityHandle';
import {
  type World,
  type WorldOptions,
  type WorldTransport,
  type WorldIdentity,
  type EntityHandle,
  type SpawnOptions,
  type ReplicationPolicy,
} from './types';

// Bounds-enforcement constants — mirror SceneSystemV2 so behaviour is identical
// during the parity-only first slice. Issue #5 deletes the duplicate.
const REST_VEL_THRESHOLD = 0.05;
const REST_Y_MAX         = TABLE_SURFACE_Y + 1.4;
const REST_Y_MIN         = TABLE_SURFACE_Y - 0.05;
const FALL_OFF_Y         = TABLE_SURFACE_Y - 2.0;

interface RestPose {
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
}

const DEFAULT_POLICY: ReplicationPolicy = {
  channelFor:  () => 'reliable',
  coalesceFor: () => 'merge',
  shouldFlush: () => true,
};

export function createWorld(opts: WorldOptions): World {
  return new WorldImpl(opts);
}

class WorldImpl implements World {
  private readonly role:       'host' | 'guest';
  private readonly threeScene: THREE.Scene;
  private readonly transport:  WorldTransport;
  private readonly identity:   WorldIdentity;
  private readonly scene:      SceneImpl;
  private readonly physics:    PhysicsWorld | null;
  private readonly replicator: HostReplicatorV2 | null;
  private readonly policy:     ReplicationPolicy;

  private readonly handles   = new Map<string, EntityHandleImpl>();
  private readonly restPoses = new Map<string, RestPose>();
  private listeners: Array<() => void> = [];

  private readonly unsubscribeMessage:  () => void;
  private readonly unsubscribePeerJoin: () => void;

  private tickIndex = 0;
  private disposed  = false;

  constructor(opts: WorldOptions) {
    registerCorePrimitives();

    this.role       = opts.role;
    this.threeScene = opts.scene;
    this.transport  = opts.transport;
    this.identity   = opts.identity;
    this.scene      = new SceneImpl();
    this.policy     = { ...DEFAULT_POLICY, ...opts.policy };

    if (opts.role === 'host') {
      this.physics    = opts.physics ?? new PhysicsWorld();
      this.replicator = new HostReplicatorV2();
      EntityComponent.setHostReplicator(this.replicator);
    } else {
      this.physics    = null;
      this.replicator = null;
    }

    this.unsubscribeMessage  = this.transport.onMessage((peerId, msg) => this.handleInbound(peerId, msg));
    this.unsubscribePeerJoin = this.transport.onPeerJoin((peerId) => this.handlePeerJoin(peerId));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  spawn(type: string, opts: SpawnOptions = {}): EntityHandle {
    if (this.role !== 'host') throw new Error('World.spawn is host-only');
    const ctx: SpawnContext = { scene: this.threeScene, physics: this.physics };
    const entity = this.scene.spawn(type, ctx, { id: opts.id });

    if (opts.position) {
      const transform = entity.getComponent(TransformComponent);
      if (transform) {
        transform.setState({
          position: opts.position,
          rotation: transform.state.rotation,
          scale:    transform.state.scale,
        });
      }
      const phys = entity.getComponent(PhysicsComponent);
      if (phys?.body) {
        phys.body.position.set(opts.position[0], opts.position[1], opts.position[2]);
        phys.body.velocity.setZero();
        phys.body.angularVelocity.setZero();
      }
    }

    if (this.replicator) this.replicator.enqueueEntitySpawn(entityToSerialized(entity));
    this.notify();
    return this.handleFor(entity);
  }

  despawn(id: string): void {
    if (this.role !== 'host') throw new Error('World.despawn is host-only');
    const ctx: SpawnContext = { scene: this.threeScene, physics: this.physics };
    const removed = this.scene.despawn(id, ctx);
    for (const removedId of removed) {
      this.handles.delete(removedId);
      this.restPoses.delete(removedId);
    }
    if (removed.length > 0 && this.replicator) this.replicator.enqueueDespawn(removed);
    if (removed.length > 0) this.notify();
  }

  // Mirrors SceneSystemV2.updateProp so existing EditorPanel writes preserve
  // behaviour. Issue #4 collapses these into component-driven actions.
  updateProp(id: string, key: string, value: unknown): void {
    const entity = this.scene.getEntity(id);
    if (!entity) return;

    if (key === 'name') {
      entity.name = String(value);
      if (this.replicator) this.replicator.enqueueEntityPatch(entity.id, { name: entity.name });
      this.notify();
      return;
    }
    if (key === 'tags') {
      entity.tags = normaliseTags(value);
      if (this.replicator) this.replicator.enqueueEntityPatch(entity.id, { tags: [...entity.tags] });
      this.notify();
      return;
    }

    const mesh = entity.getComponent(MeshComponent);
    if (!mesh) return;

    if (entity.type === 'board') {
      const cur = mesh.state.size as [number, number, number];
      if      (key === 'width')      mesh.setState({ size: [Number(value), cur[1], cur[2]] });
      else if (key === 'depth')      mesh.setState({ size: [cur[0], cur[1], Number(value)] });
      else if (key === 'textureUrl') mesh.setState({ textureRefs: { ...mesh.state.textureRefs, default: String(value ?? '') } });
    } else if (entity.type === 'token') {
      if (key === 'color') mesh.setState({ tint: String(value ?? '#ffffff') });
    }
    this.notify();
  }

  // ── Per-frame driver ─────────────────────────────────────────────────────
  tick(_dtSeconds: number): void {
    if (this.disposed) return;

    if (this.role === 'host' && this.physics && this.replicator) {
      this.physics.step(_dtSeconds);
      this.enforceTableBounds();
      this.syncFromPhysics();

      const unreliable = this.replicator.flushUnreliable();
      const reliable   = this.replicator.flushReliable();
      // Reliable first so guests construct entities before unreliable patches
      // arrive — patches for unknown entities are silently dropped, so first-
      // tick transform updates survive the round trip.
      for (const msg of reliable)   this.transport.send(msg, { reliable: true  });
      for (const msg of unreliable) this.transport.send(msg, { reliable: false });
    }

    this.tickIndex++;
  }

  private enforceTableBounds(): void {
    for (const entity of this.scene.all()) {
      const phys = entity.getComponent(PhysicsComponent);
      if (!phys?.body) continue;
      const body = phys.body;
      const px = body.position.x, py = body.position.y, pz = body.position.z;

      const onTable = py >= REST_Y_MIN && py <= REST_Y_MAX
                   && Math.abs(px) <= TABLE_WIDTH  / 2
                   && Math.abs(pz) <= TABLE_DEPTH / 2;
      const settled = body.velocity.length() + body.angularVelocity.length() < REST_VEL_THRESHOLD;
      if (onTable && settled) {
        this.restPoses.set(entity.id, {
          px, py, pz,
          qx: body.quaternion.x, qy: body.quaternion.y,
          qz: body.quaternion.z, qw: body.quaternion.w,
        });
      }

      const restPose = this.restPoses.get(entity.id);
      if (py < FALL_OFF_Y && restPose) {
        body.position.set(restPose.px, restPose.py, restPose.pz);
        body.quaternion.set(restPose.qx, restPose.qy, restPose.qz, restPose.qw);
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.wakeUp();
      }
    }
  }

  private syncFromPhysics(): void {
    for (const entity of this.scene.all()) {
      entity.getComponent(PhysicsComponent)?.syncToTransform();
    }
  }

  // ── Read surface ─────────────────────────────────────────────────────────
  get(id: string): EntityHandle | undefined {
    const entity = this.scene.getEntity(id);
    return entity ? this.handleFor(entity) : undefined;
  }

  all(): EntityHandle[] {
    return this.scene.all().map(e => this.handleFor(e));
  }

  pickByObject3D(obj: THREE.Object3D): EntityHandle | undefined {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      for (const entity of this.scene.all()) {
        const t = entity.getComponent(TransformComponent);
        if (t?.object3d === cur) return this.handleFor(entity);
      }
      cur = cur.parent;
    }
    return undefined;
  }

  forEach(fn: (h: EntityHandle) => void): void {
    for (const entity of this.scene.all()) fn(this.handleFor(entity));
  }

  // ── Subscriptions ────────────────────────────────────────────────────────
  // Coalesced — fires once per state-affecting operation (spawn, despawn,
  // updateProp, inbound message). Per-tick coalescing tightens further in
  // issue #4 when EditorPanel becomes the primary consumer.
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // ── Snapshot / load ──────────────────────────────────────────────────────
  snapshot(): EntitySerialized[] {
    return this.scene.all().map(entityToSerialized);
  }

  loadSnapshot(snaps: readonly EntitySerialized[]): void {
    const ctx: SpawnContext = { scene: this.threeScene, physics: this.physics };
    this.scene.load(snaps, ctx);
    this.notify();
  }

  // ── Inbound dispatch ─────────────────────────────────────────────────────
  // Mirrors applySceneMessage but writes to this World's own SceneImpl. Issue
  // #5 deletes the legacy free-function once ThreeCanvas migrates.
  private handleInbound(_peerId: string, msg: SceneMessage): void {
    if (this.disposed) return;
    switch (msg.type) {
      case 'entity-spawn': {
        if (this.scene.has(msg.entity.id)) return;
        const ctx: SpawnContext = { scene: this.threeScene, physics: this.physics };
        this.scene.load([msg.entity], ctx);
        this.notify();
        return;
      }

      case 'component-patches': {
        let any = false;
        for (const p of msg.patches) {
          const entity = this.scene.getEntity(p.entityId);
          if (!entity) continue;
          const comp = entity.components.get(p.typeId);
          if (!comp) continue;
          comp.applyRemoteState(p.partial);
          any = true;
        }
        if (any) this.notify();
        return;
      }

      case 'entity-patch': {
        const entity = this.scene.getEntity(msg.entityId);
        if (!entity) return;
        mergeEntityFields(entity, msg.partial);
        this.notify();
        return;
      }

      case 'despawn-batch': {
        const ctx: SpawnContext = { scene: this.threeScene, physics: this.physics };
        let any = false;
        for (const id of msg.entityIds) {
          const removed = this.scene.despawn(id, ctx);
          for (const r of removed) {
            this.handles.delete(r);
            this.restPoses.delete(r);
            any = true;
          }
        }
        if (any) this.notify();
        return;
      }

      case 'invoke-action':
      case 'request-update':
        // Host-only inbound paths. Guest drops; host wires HostInputDispatcher
        // in issue #2 to reach these.
        return;

      case 'hold-claim': {
        const entity = this.scene.getEntity(msg.entityId);
        if (!entity) return;
        entity.heldBy = msg.seat;
        this.notify();
        return;
      }

      case 'hold-release': {
        const entity = this.scene.getEntity(msg.entityId);
        if (!entity) return;
        entity.heldBy = null;
        this.notify();
        return;
      }
    }
  }

  // Late-join handler stub — issue #8 implements snapshot replay through this
  // hook. Today nothing is wired to fire onPeerJoin in production (ThreeCanvas
  // owns its own logic until issue #2 migrates), so this is a no-op.
  private handlePeerJoin(_peerId: string): void {
    // intentionally empty
  }

  // ── Dispose ──────────────────────────────────────────────────────────────
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeMessage();
    this.unsubscribePeerJoin();

    if (this.role === 'host' && EntityComponent.hostReplicator === this.replicator) {
      EntityComponent.setHostReplicator(null);
    }

    const ctx: SpawnContext = { scene: this.threeScene, physics: this.physics };
    for (const id of this.scene.all().map(e => e.id)) {
      this.scene.despawn(id, ctx);
    }

    this.handles.clear();
    this.restPoses.clear();
    this.listeners = [];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private handleFor(entity: Entity): EntityHandleImpl {
    const cached = this.handles.get(entity.id);
    if (cached && cached.entity === entity) return cached;
    const handle = new EntityHandleImpl(entity);
    this.handles.set(entity.id, handle);
    return handle;
  }
}

function mergeEntityFields(entity: Entity, partial: EntityFieldsPartial): void {
  if (partial.name          !== undefined) entity.name          = partial.name;
  if (partial.tags          !== undefined) entity.tags          = [...partial.tags];
  if (partial.owner         !== undefined) entity.owner         = partial.owner;
  if (partial.privateToSeat !== undefined) entity.privateToSeat = partial.privateToSeat;
  if (partial.parentId      !== undefined) entity.parentId      = partial.parentId;
  if (partial.children      !== undefined) entity.children      = [...partial.children];
}

function normaliseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    const s = String(v).trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
