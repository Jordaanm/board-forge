// Wire shapes for the v2 entity-component replicator.
// Slice #2 of planning/issues/issues--scene-graph.md.
//
// `ComponentPatch` is a record (no `type:`) — bundled into a
// `component-patches` envelope by the replicator. Everything else is a
// self-contained discriminated message.

import { type SeatIndex } from '../seats/SeatLayout';
import { type ReplicationChannel } from './EntityComponent';
import { type EntitySerialized } from './Scene';

export type { EntitySerialized };

// Entity-level fields that may appear in an EntityPatch.
export type EntityFieldsPartial = Partial<{
  name:          string;
  tags:          string[];
  owner:         SeatIndex | null;
  privateToSeat: SeatIndex | null;
  parentId:      string | null;
  children:      string[];
}>;

// Per-component patch — payload inside a `component-patches` envelope.
export interface ComponentPatch {
  entityId: string;
  typeId:   string;
  partial:  Record<string, unknown>;
}

// Per-channel batched envelope for ComponentPatches.
export interface ComponentPatchesMessage {
  type:    'component-patches';
  channel: ReplicationChannel;
  patches: ComponentPatch[];
}

export interface EntityPatch {
  type:     'entity-patch';
  entityId: string;
  partial:  EntityFieldsPartial;
}

// Per-entity spawn — carries the full EntitySerialized snapshot so the guest
// can construct the entity locally. Always reliable.
export interface EntitySpawn {
  type:   'entity-spawn';
  entity: EntitySerialized;
}

// Reverse-tree order of entity ids to delete. Always reliable.
export interface DespawnBatch {
  type:      'despawn-batch';
  entityIds: string[];
}

export interface InvokeAction {
  type:            'invoke-action';
  entityId:        string;
  componentTypeId: string;
  actionId:        string;
  args?:           object;
}

export interface HoldClaim {
  type:     'hold-claim';
  entityId: string;
  seat:     SeatIndex;
}

export interface HoldRelease {
  type:     'hold-release';
  entityId: string;
}

export interface RequestUpdate {
  type:     'request-update';
  entityId: string;
  typeId:   string;
  partial:  Record<string, unknown>;
}

// Discriminated union of every wire message that flows over a scene channel.
export type SceneMessage =
  | ComponentPatchesMessage
  | EntitySpawn
  | EntityPatch
  | DespawnBatch
  | InvokeAction
  | HoldClaim
  | HoldRelease
  | RequestUpdate;
