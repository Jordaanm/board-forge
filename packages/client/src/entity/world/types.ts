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
import { type EntitySerialized, type SceneImpl } from '../Scene';
import { type SceneMessage } from '../wire';
import { type SeatIndex } from '../../seats/SeatLayout';
import { type PhysicsWorld } from '../../physics/PhysicsWorld';
import { type GuestInputMessage } from '../../net/SceneState';
import { type PrivateFieldRegistry } from '../../seats/PrivacyScrubber';
import { type HoldService } from '../HoldService';

// Inbound from the wire: scene-level replication plus guest input streams.
// Outbound from the host is always SceneMessage — guest input is one-way.
export type WorldInboundMessage = SceneMessage | GuestInputMessage;

export interface ReplicationTarget {
  peerId:   string;
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

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

  // Transitional surfaces — issue #3 (drag unification) and #8 (peer-join
  // handler) delete these. Returning HoldService directly leaks an
  // implementation detail; live with it for one slice.
  holdService(): HoldService | null;
  releasePeer(peerId: string): void;
  replayTo(peerId: string): void;

  dispose(): void;
}

// Single seam for the wire. Production: RtcTransport over ConnectionManager.
// Tests: createInMemoryBusPair() — see InMemoryTransport.ts.
export interface WorldTransport {
  send(msg: SceneMessage, opts: { reliable: boolean }): void;
  sendTo?(peerId: string, msg: SceneMessage): void;
  onMessage(handler: (peerId: string, msg: WorldInboundMessage) => void): () => void;
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
  // Optional pre-built SceneImpl. ThreeCanvas passes the global Scene singleton
  // so legacy DragController / findEntityByObject3D / Scene.getEntity lookups
  // still see the same entities; tests omit and get an isolated SceneImpl per
  // World. Issue #5 deletes the singleton entirely.
  entityScene?: SceneImpl;
  // Per-target fan-out for privacy scrubbing. When provided, host flushes go
  // through `transport.sendTo(peerId, scrubbed)` per target instead of the
  // broadcast `transport.send`. Issue #7 moves this into RtcTransport.
  getReplicationTargets?: () => ReplicationTarget[];
  privateFieldRegistry?:  PrivateFieldRegistry;
  // Required on the host for HostInputDispatcher's ownership checks; resolves
  // a peer id to its current seat. Returns null for spectators.
  getPeerSeat?: (peerId: string) => SeatIndex | null;
}
