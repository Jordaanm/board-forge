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
  isContained:   boolean;
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

// Late-join payload (issue #8 of issues--arch.md) — host's complete scene
// shipped to a freshly-connected guest in one envelope. Guests apply via
// SceneImpl.load so two-phase construction (all entities materialised before
// any onSpawn fires) keeps cross-entity GUID refs resolvable. Always reliable.
export interface SceneSnapshot {
  type:     'scene-snapshot';
  entities: EntitySerialized[];
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
  // End-of-drag velocity (PRD § Drag rewrite — slice #5). Optional because
  // some releases drop the body where it sits (peer disconnect, axis drag,
  // pending-claim timeout) without imparting motion.
  vx?:      number;
  vy?:      number;
  vz?:      number;
}

export interface RequestUpdate {
  type:     'request-update';
  entityId: string;
  typeId:   string;
  partial:  Record<string, unknown>;
}

// Apply a one-shot impulse to an entity's physics body — issue #5a of
// issues--tools.md. Reliable channel (single-shot, not coalesced). Host
// validates `canManipulate` + `!isLocked` before applying.
export interface ApplyImpulse {
  type:     'apply-impulse';
  entityId: string;
  vx:       number;
  vy:       number;
  vz:       number;
}

// Drag-from-hand-panel-onto-canvas (issue #5 of issues--hand.md). Reliable
// channel (single-shot). Host validates that the request originates from the
// hand's owner (or anyone for a null-owner shared hand) before tweening.
export interface PlayCardToTable {
  type:     'play-card-to-table';
  entityId: string;
  x:        number;
  y:        number;
  z:        number;
}

// Drag-within-hand-panel reorder (issue #6 of issues--hand.md). `newOrder`
// must be a permutation of the hand's current `containedIds`. Host validates
// owner-match and permutation membership before applying.
export interface ReorderHand {
  type:         'reorder-hand';
  handEntityId: string;
  newOrder:     string[];
}

// Drag-from-3D-canvas onto a hand panel (issue #7 of issues--hand.md). After
// GrabTool releases the hold, host tweens the entity to the hand's centre so
// the zone-enter logic slots it normally. Host validates that the requesting
// seat owns the destination hand (or it's a null-owner shared hand).
export interface TweenIntoHand {
  type:         'tween-into-hand';
  entityId:     string;
  handEntityId: string;
}

// Right-click "Draw N" on a deck. Issue #6 of issues--deck.md. Reliable
// channel (single-shot). Host validates `canManipulate(deck.owner)` and that
// the caller has a main hand, then pops `min(count, cards.length)` cards from
// the front and tweens each into the caller's main hand.
export interface DrawFromDeck {
  type:   'draw-from-deck';
  deckId: string;
  count:  number;
}

// Right-click "Shuffle" on a deck. Issue #7 of issues--deck.md. Reliable
// channel. Host validates `canManipulate(deck.owner)`, runs Fisher-Yates on
// the deck's `cards`, and plays a 200ms rotation jitter tween for feedback.
export interface ShuffleDeck {
  type:   'shuffle-deck';
  deckId: string;
}

// Cosmetic broadcast originated by a Tool (issue #3 of issues--tools.md).
// Rides the unreliable channel — missed messages are not retried. Payload
// schema is per-tool (e.g. ping carries `{ entityId }` or `{ point: [x,z] }`).
// PingTool is the first consumer in the next slice; this slice only lays the
// wire surface.
export interface ToolBroadcast {
  type:    'tool-broadcast';
  toolId:  string;
  peerId:  string;
  seat:    SeatIndex | null;
  payload: unknown;
}

// Discriminated union of every wire message that flows over a scene channel.
export type SceneMessage =
  | ComponentPatchesMessage
  | EntitySpawn
  | SceneSnapshot
  | EntityPatch
  | DespawnBatch
  | InvokeAction
  | HoldClaim
  | HoldRelease
  | RequestUpdate
  | ApplyImpulse
  | PlayCardToTable
  | ReorderHand
  | TweenIntoHand
  | DrawFromDeck
  | ShuffleDeck
  | ToolBroadcast;
