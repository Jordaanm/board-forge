// Abstract base for entity components — the unit of behaviour and replicated
// state in the new scene graph (slice #1 of planning/issues/issues--scene-graph.md).
//
// Concrete components own both their replicated `state` and any derived view
// artefacts (THREE.Object3D, CANNON.Body). `toJSON`/`fromJSON` walk only `state`;
// view is rebuilt from state in `onSpawn`.

import { type Entity } from './Entity';
import { type SeatIndex } from '../seats/SeatLayout';

export type ReplicationChannel = 'reliable' | 'unreliable';

// Filled out in slice #3 (port primitives) — scene root, physics world, etc.
export interface SpawnContext {}

export interface MenuContext {
  recipientSeat: SeatIndex | null;
  isHost:        boolean;
  entity:        Entity;
}

// Slice #7 (context-menu refactor) is the consumer; defined here so the hook
// signature on the base class is concrete.
export type MenuItem =
  | { kind: 'action';    id: string; label: string; disabled?: boolean }
  | { kind: 'submenu';   label: string; items: MenuItem[] }
  | { kind: 'heading';   label: string }
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

  abstract onSpawn(ctx: SpawnContext): void;
  abstract onPropertiesChanged(changed: Partial<TState>): void;

  onDespawn       (_ctx: SpawnContext):                                                  void { }
  onContextMenu   (_ctx: MenuContext):                                                   MenuItem[] { return []; }
  onCollision     (_other: Entity, _event: CollisionEvent):                              void { }
  onParentChanged (_newParentId: string | null, _oldParentId: string | null):            void { }
  onOwnerChanged  (_newOwner: SeatIndex | null, _oldOwner: SeatIndex | null):            void { }
  onAction        (_actionId: string, _args: object | undefined, _ctx: ActionContext):   void { }

  // Host-only at runtime. Merges into `state`, fires `onPropertiesChanged`.
  // Slice #2 (replication) extends this to queue a per-component patch.
  setState(patch: Partial<TState>): void {
    Object.assign(this.state as object, patch);
    this.onPropertiesChanged(patch);
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
