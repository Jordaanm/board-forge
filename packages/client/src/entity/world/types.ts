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
import { type SceneMessage, type ToolBroadcast } from '../wire';
import { type SeatIndex } from '../../seats/SeatLayout';
import { type PhysicsWorld } from '../../physics/PhysicsWorld';
import { type GuestInputMessage } from '../../net/SceneState';

// Inbound from the wire: scene-level replication plus guest input streams.
export type WorldInboundMessage = SceneMessage | GuestInputMessage;

// Outbound from the World: host emits SceneMessages (replication); guest emits
// GuestInputMessages (drag move) and SceneMessages (hold-claim / hold-release).
export type WorldOutboundMessage = SceneMessage | GuestInputMessage;

export interface ReplicationTarget {
  peerId:   string;
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

export interface SpawnOptions {
  id?:       string;
  position?: [number, number, number];
}

// Symmetric host/guest facade over an Entity. The mutation verbs route
// internally — host writes the body / HoldService directly, guest sends the
// equivalent RPC and applies an optimistic local update where applicable.
export interface EntityHandle {
  readonly id:     string;
  readonly entity: Entity;

  position(): THREE.Vector3;
  velocity(): THREE.Vector3;
  heldBy(): SeatIndex | null;

  get<T extends EntityComponent<any>>(cls: ComponentClass<T>): T | undefined;

  // Authoritative move on host (writes the physics body); optimistic transform
  // update + `guest-drag-move` RPC on guest. Used by DragController during
  // pointer-driven carry.
  setPosition(x: number, y: number, z: number): void;

  // Ownership policy gate for starting a drag — wraps canManipulate against
  // the World's identity. Independent of `heldBy` (callers also check that).
  canStartDrag(): boolean;

  // Hold-claim attempt. Returns true if the local check passes (entity is
  // free + ownership allows). Host completes the claim synchronously; guest
  // dispatches a `hold-claim` RPC and the caller polls `heldBy()` for the
  // host's echo.
  tryHold(seat: SeatIndex): boolean;

  // Drop the hold. Host runs HoldService.release locally. Guest dispatches a
  // `hold-release` RPC. Velocity is the end-of-drag throw, optional.
  release(velocity?: { vx: number; vy: number; vz: number }): void;

  // One-shot impulse on the entity's PhysicsComponent — issue #5a of
  // issues--tools.md. Both paths gate on canManipulate + !isLocked. Host
  // applies directly; guest dispatches `apply-impulse` RPC and the host
  // validates again on receipt.
  applyImpulse(v: { x: number; y: number; z: number }): void;
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

  // Transitional surface — `releasePeer` stays until input dispatch is fully
  // owned by World. Late-join (formerly `replayTo`) is now driven internally
  // by transport.onPeerJoin (issue #8).
  releasePeer(peerId: string): void;

  // Cosmetic broadcast from a Tool — issue #4 of issues--tools.md. Routes on
  // the unreliable channel; fires local subscribers immediately so the sender
  // sees their own ping. On host inbound, relays to other peers.
  broadcastToolMessage(toolId: string, payload: unknown): void;
  onToolBroadcast(handler: (msg: ToolBroadcast) => void): () => void;

  dispose(): void;
}

// Single seam for the wire. Production: RtcTransport over ConnectionManager.
// Tests: createInMemoryBusPair() — see InMemoryTransport.ts.
export interface WorldTransport {
  send(msg: WorldOutboundMessage, opts: { reliable: boolean }): void;
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
  // Required on the host for HostInputDispatcher's ownership checks; resolves
  // a peer id to its current seat. Returns null for spectators.
  getPeerSeat?: (peerId: string) => SeatIndex | null;
}
