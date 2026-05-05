// Per-recipient scrubbing seam for scene replication.
//
// Listed component-state fields are substituted with the empty string for any
// recipient other than the entity's `privateToSeat` (and the host). Substitute
// rather than delete so the receiver's local state is actively overwritten
// on receipt — otherwise pre-private values would persist (and a fly-around
// peek would read them off the cached mesh material).

import { type SeatIndex } from './SeatLayout';
import { type Entity } from '../entity/Entity';
import { type SceneMessage } from '../entity/wire';

export interface RecipientContext {
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

export interface PrivateFieldRegistry {
  // Maps componentTypeId → state-field names to redact when the recipient
  // is not the entity's privateToSeat.
  readonly [componentTypeId: string]: readonly string[] | undefined;
}

export const EMPTY_PRIVATE_FIELD_REGISTRY: PrivateFieldRegistry = Object.freeze({});

// Default registry for hand privacy (issue #8 of issues--hand.md). CardComponent
// face/back hold the texture URLs; FlatViewComponent.textureRef is the 2D
// surface used by the hand panel — together these are the leakage vectors a
// fly-around peek could exploit.
export const DEFAULT_PRIVATE_FIELDS: PrivateFieldRegistry = Object.freeze({
  card:     Object.freeze(['face', 'back']),
  flatview: Object.freeze(['textureRef']),
}) as PrivateFieldRegistry;

// Resolves an entityId to its Entity (or undefined). Caller-supplied so this
// module no longer depends on the Scene singleton — issue #5 of issues--arch.md.
export type EntityLookup = (entityId: string) => Entity | undefined;

// Per-recipient scrub for v2 SceneMessages. Looks up each referenced entity
// to read `entity.privateToSeat` and decides whether component state
// fields listed in the registry must be redacted for this recipient.
//
// With the empty registry shipped today this is the identity. PRD-2 fills in
// the registry and the host loop already runs through this seam.
export function scrubSceneMessage(
  ctx:       RecipientContext,
  msg:       SceneMessage,
  registry:  PrivateFieldRegistry,
  getEntity: EntityLookup,
): SceneMessage {
  if (Object.keys(registry).length === 0) return msg;

  switch (msg.type) {
    case 'component-patches': {
      const out = msg.patches.map(p => {
        const entity = getEntity(p.entityId);
        if (!entity) return p;
        return redactComponentPatch(ctx, entity, p, registry, getEntity);
      });
      return { type: 'component-patches', channel: msg.channel, patches: out };
    }
    case 'entity-spawn': {
      const e          = msg.entity;
      if (ctx.isHost) return msg;
      const seatPriv   = e.privateToSeat !== null && ctx.peerSeat !== e.privateToSeat;
      const inDeck     = isInDeck(e.parentId, getEntity);
      if (!seatPriv && !inDeck) return msg;
      const components: Record<string, object> = {};
      for (const [typeId, state] of Object.entries(e.components)) {
        const fields = registry[typeId];
        components[typeId] = fields
          ? redactFields(state as Record<string, unknown>, fields, 'spawn')
          : state;
      }
      return { type: 'entity-spawn', entity: { ...e, components } };
    }
    default:
      return msg;
  }
}

// True when the supplied parent id resolves to an entity carrying a
// DeckComponent. Used by the in-deck privacy rule (issue #5 of issues--deck.md):
// a card whose parent is a deck has its face / back scrubbed for every non-host
// peer regardless of `privateToSeat`.
function isInDeck(parentId: string | null, getEntity: EntityLookup): boolean {
  if (!parentId) return false;
  const parent = getEntity(parentId);
  if (!parent) return false;
  return parent.components.has('deck');
}

function redactComponentPatch(
  ctx:        RecipientContext,
  entity:     Entity,
  patch:      { entityId: string; typeId: string; partial: Record<string, unknown> },
  registry:   PrivateFieldRegistry,
  getEntity:  EntityLookup,
): { entityId: string; typeId: string; partial: Record<string, unknown> } {
  if (ctx.isHost) return patch;
  const seatPriv = entity.privateToSeat !== null && ctx.peerSeat !== entity.privateToSeat;
  const inDeck   = isInDeck(entity.parentId, getEntity);
  if (!seatPriv && !inDeck) return patch;
  const fields = registry[patch.typeId];
  if (!fields) return patch;
  return { ...patch, partial: redactFields(patch.partial, fields, 'patch') };
}

// For entity-spawn we substitute every listed field (so the receiver's
// CardComponent.fromJSON sees `face: ''`, not undefined). For component-patches
// we substitute only fields that were already present in the partial — adding
// fields that weren't in the partial would synthesise data that the host never
// sent. The combination of "host re-emits face/back on privacy change" plus
// "scrubber substitutes" covers the camera-fly-around peeking case.
function redactFields(
  state:    Record<string, unknown>,
  fields:   readonly string[],
  mode:     'spawn' | 'patch',
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  for (const f of fields) {
    if (mode === 'spawn' || f in out) out[f] = '';
  }
  return out;
}
