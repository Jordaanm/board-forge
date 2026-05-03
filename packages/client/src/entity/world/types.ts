// Public interfaces for the World module — issue #1 of issues--arch.md.
//
// `World` consolidates entity lifecycle, replication, and the query surface
// for the renderer / editor. `WorldTransport` is the single seam between the
// World and the wire (production WebRTC vs in-memory test pair). The full
// implementation lands incrementally — issue #1 ships interfaces + a facade
// that wraps the existing Scene / HostReplicatorV2 / GuestReceiver so future
// slices can migrate call sites one at a time.

import * as THREE from 'three';
import { type Entity } from '../Entity';
import { type EntityComponent, type ComponentClass } from '../EntityComponent';
import { type EntitySerialized } from '../Scene';
import { type SceneMessage } from '../wire';
import { type SeatIndex } from '../../seats/SeatLayout';
import { type PhysicsWorld } from '../../physics/PhysicsWorld';

export interface SpawnOptions {
  id?:       string;
  position?: [number, number, number];
}

// Read-surface facade over an Entity. Symmetric across host/guest. Issue #3
// adds the mutation verbs (setPosition / requestMove / tryHold / release).
export interface EntityHandle {
  readonly id:     string;
  readonly entity: Entity;

  position(): THREE.Vector3;
  velocity(): THREE.Vector3;
  heldBy(): SeatIndex | null;

  get<T extends EntityComponent<any>>(cls: ComponentClass<T>): T | undefined;
}

export interface World {
  // Lifecycle (host).
  spawn(type: string, opts?: SpawnOptions): EntityHandle;
  despawn(id: string): void;
  updateProp(id: string, key: string, value: unknown): void;

  // Per-frame driver. Host: physics step, bounds, syncFromPhysics, replicator
  // flush. Guest: no-op (inbound state arrives via transport.onMessage).
  tick(dtSeconds: number): void;

  // Read surface.
  get(id: string): EntityHandle | undefined;
  all(): EntityHandle[];
  pickByObject3D(obj: THREE.Object3D): EntityHandle | undefined;
  forEach(fn: (h: EntityHandle) => void): void;

  // Coalesced subscription — fires once per state-affecting tick, not per patch.
  subscribe(fn: () => void): () => void;

  // Late-join + save/load.
  snapshot(): EntitySerialized[];
  loadSnapshot(snaps: readonly EntitySerialized[]): void;

  dispose(): void;
}

// Single seam for the wire. Production: RtcTransport over ConnectionManager.
// Tests: createInMemoryBusPair() — see InMemoryTransport.ts.
export interface WorldTransport {
  send(msg: SceneMessage, opts: { reliable: boolean }): void;
  sendTo?(peerId: string, msg: SceneMessage): void;
  onMessage(handler: (peerId: string, msg: SceneMessage) => void): () => void;
  onPeerJoin(handler: (peerId: string) => void): () => void;
}

// Network-tuning knobs. Issue #1 defines the shape; issue #10 implements
// coalescing + flush cadence + channel routing through this object.
export interface ReplicationPolicy {
  channelFor(typeId: string): 'reliable' | 'unreliable';
  coalesceFor(typeId: string): 'merge' | 'replace' | 'last-write-wins';
  shouldFlush(typeId: string, ctx: { tick: number; nowMs: number }): boolean;
}

export interface WorldIdentity {
  isHost:      boolean;
  selfSeat():  SeatIndex | null;
  selfPeerId(): string | null;
}

export interface WorldOptions {
  role:      'host' | 'guest';
  scene:     THREE.Scene;
  identity:  WorldIdentity;
  transport: WorldTransport;
  // Host auto-creates a PhysicsWorld if omitted. Guests pass nothing.
  physics?:  PhysicsWorld;
  // Layered over defaults — sane defaults preserve current behaviour.
  policy?:   Partial<ReplicationPolicy>;
}
