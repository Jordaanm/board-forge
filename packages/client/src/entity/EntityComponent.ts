// Abstract base for entity components — the unit of behaviour and replicated
// state in the new scene graph (slice #1 of planning/issues/issues--scene-graph.md).
//
// Concrete components own both their replicated `state` and any derived view
// artefacts (THREE.Object3D, CANNON.Body). `toJSON`/`fromJSON` walk only `state`;
// view is rebuilt from state in `onSpawn`.

import * as THREE from 'three';
import { type Entity } from './Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { type PhysicsWorld } from '../physics/PhysicsWorld';
import { type ComponentPatch, type EntityFieldsPartial } from './wire';

export type ReplicationChannel = 'reliable' | 'unreliable';

// The narrow surface a component needs to push state mutations onto the wire.
// Issue #6 of issues--arch.md retired the `EntityComponent.hostReplicator`
// process-global static — components now hold a per-instance reference set
// when their owning entity is added to a Scene that has a World. Issue #10
// pushed channel selection into ReplicationPolicy, so callers no longer pass
// it explicitly.
export interface ComponentReplicator {
  enqueueComponentPatch(patch: ComponentPatch): void;
  // Replicates a partial entity-level field mutation (privateToSeat, owner,
  // tags, etc.). Components mutate `entity.<field>` directly and call this to
  // propagate. Issue #3 of issues--hand.md (HandComponent privacy mutation).
  enqueueEntityPatch(entityId: string, partial: EntityFieldsPartial): void;
}

// Carried into every onSpawn / onDespawn call. Components own their view
// artefacts and need the scene root + physics world to attach / detach them.
// `entityScene` is the SceneImpl that owns this spawn — components that look
// up sibling entities (e.g. PhysicsComponent.findEntityByBody) read it here
// instead of going through a process-global singleton.
export interface SpawnContext {
  scene:        THREE.Scene;
  physics:      PhysicsWorld | null;  // null on guests — they don't simulate.
  entityScene:  EntityScene;
}

// Minimal Scene surface — kept here as an interface so components don't pull
// in the SceneImpl class type and create a circular import.
export interface EntityScene {
  all(): Entity[];
  getEntity(id: string): Entity | undefined;
  has(id: string): boolean;
}

export interface MenuContext {
  recipientSeat: SeatIndex | null;
  isHost:        boolean;
  entity:        Entity;
}

// Slice #7 (context-menu refactor) is the consumer; defined here so the hook
// signature on the base class is concrete. `componentTypeId` is filled in by
// the aggregator after each component returns its items — components do not
// set it themselves.
export type MenuItem =
  | {
      kind:  'action';
      id:    string;
      label: string;
      componentTypeId?: string;
      disabled?:        boolean;
      // Optional preset args dispatched alongside the click. Used by submenu
      // sets like Draw ▸ {1,2,3,5} where each option carries its count.
      args?: object;
    }
  | { kind: 'colorpicker'; id: string; label: string; value: string; componentTypeId?: string }
  | {
      kind:    'numeric';
      id:      string;
      label:   string;
      min?:    number;
      max?:    number;
      default?: number;
      componentTypeId?: string;
    }
  | { kind: 'submenu';     label: string; items: MenuItem[] }
  | { kind: 'heading';     label: string }
  | { kind: 'separator' };

// Slice #5 (drag rewrite) wires this up; opaque for slice #1.
export interface CollisionEvent {}

export interface ActionContext {
  recipientSeat: SeatIndex | null;
  isHost:        boolean;
  entity:        Entity;
}

export type ComponentClass<T extends EntityComponent<any> = EntityComponent<any>> = {
  new (...args: any[]): T;
  typeId:   string;
  requires: readonly string[];
  channel:  ReplicationChannel;
};

export abstract class EntityComponent<TState extends object> {
  // Subclasses MUST override `typeId`. Empty string is a sentinel — the
  // component registry rejects classes that leave it unset.
  static typeId:   string             = '';
  static requires: readonly string[]  = [];
  static channel:  ReplicationChannel = 'reliable';

  state!:  TState;
  entity!: Entity;

  // Host-only — points at the owning World's HostReplicatorV2. Set when the
  // entity is added to a Scene that has a `world` (i.e. on host). Null on
  // guest, on detached entities, and on entities owned by a guest World.
  // setState reads this; applyRemoteState (the guest inbound path) does not.
  world: ComponentReplicator | null = null;

  abstract onSpawn(ctx: SpawnContext): void;
  abstract onPropertiesChanged(changed: Partial<TState>): void;

  onDespawn            (_ctx: SpawnContext):                                                  void { }
  onContextMenu        (_ctx: MenuContext):                                                   MenuItem[] { return []; }
  onCollision          (_other: Entity, _event: CollisionEvent):                              void { }
  onParentChanged      (_newParentId: string | null, _oldParentId: string | null):            void { }
  onOwnerChanged       (_newOwner: SeatIndex | null, _oldOwner: SeatIndex | null):            void { }
  onIsContainedChanged (_isContained: boolean):                                               void { }
  onAction             (_actionId: string, _args: object | undefined, _ctx: ActionContext):   void { }

  // Host-only at runtime. Merges into `state`, fires `onPropertiesChanged`,
  // and queues a ComponentPatch on the owning World's replicator (if any).
  // Channel selection + coalescing happen inside the replicator via
  // ReplicationPolicy; setState doesn't need to pass either.
  setState(patch: Partial<TState>): void {
    Object.assign(this.state as object, patch);
    this.onPropertiesChanged(patch);
    if (this.world && this.entity) {
      const ctor = this.constructor as ComponentClass;
      this.world.enqueueComponentPatch({
        entityId: this.entity.id,
        typeId:   ctor.typeId,
        partial:  patch as Record<string, unknown>,
      });
    }
  }

  // Inbound network path. Same merge + hook, never re-queues replication.
  applyRemoteState(patch: Partial<TState>): void {
    Object.assign(this.state as object, patch);
    this.onPropertiesChanged(patch);
  }

  toJSON(): object {
    return { ...(this.state as object) };
  }

  fromJSON(o: object): void {
    this.state = { ...o } as TState;
  }
}
