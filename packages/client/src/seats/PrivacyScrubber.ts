// Per-recipient scrubbing seam for scene replication.
// MVP: identity. PRD-2 registers `private` fields per component type and the
// seam redacts them when `recipient.seat !== entity.privateToSeat`.

import { type SeatIndex } from './SeatLayout';
import { Scene } from '../entity/Scene';
import { type SceneMessage } from '../entity/wire';

export interface RecipientContext {
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

export interface PrivateFieldRegistry {
  // Maps componentTypeId → state-field names to redact when the recipient
  // is not the entity's privateToSeat. Empty for now, will be populated when implementing cards and hands.
  readonly [componentTypeId: string]: readonly string[] | undefined;
}

export const EMPTY_PRIVATE_FIELD_REGISTRY: PrivateFieldRegistry = Object.freeze({});

// Legacy seam (kept for the v1 ObjectState path's tests; no v1 callers
// remain after slice #4).
export function scrubFor<T>(
  _ctx:     RecipientContext,
  entity:   T,
  registry: PrivateFieldRegistry,
): T {
  if (Object.keys(registry).length === 0) return entity;
  return entity;
}

// Per-recipient scrub for v2 SceneMessages. Looks up each referenced entity
// to read `entity.privateToSeat` and decides whether component state
// fields listed in the registry must be redacted for this recipient.
//
// With the empty registry shipped in slice #6, this is the identity. PRD-2
// fills in the registry and the host loop already runs through this seam.
export function scrubSceneMessage(
  ctx:      RecipientContext,
  msg:      SceneMessage,
  registry: PrivateFieldRegistry,
): SceneMessage {
  if (Object.keys(registry).length === 0) return msg;

  switch (msg.type) {
    case 'component-patches': {
      const out = msg.patches.map(p => {
        const entity = Scene.getEntity(p.entityId);
        if (!entity) return p;
        return redactComponentPatch(ctx, entity.privateToSeat, p, registry);
      });
      return { type: 'component-patches', channel: msg.channel, patches: out };
    }
    case 'entity-spawn': {
      const e       = msg.entity;
      const isOwner = ctx.isHost || ctx.peerSeat === e.privateToSeat || e.privateToSeat === null;
      if (isOwner) return msg;
      const components: Record<string, object> = {};
      for (const [typeId, state] of Object.entries(e.components)) {
        const fields = registry[typeId];
        components[typeId] = fields ? redactFields(state as Record<string, unknown>, fields) : state;
      }
      return { type: 'entity-spawn', entity: { ...e, components } };
    }
    default:
      return msg;
  }
}

function redactComponentPatch(
  ctx:           RecipientContext,
  privateToSeat: SeatIndex | null,
  patch:         { entityId: string; typeId: string; partial: Record<string, unknown> },
  registry:      PrivateFieldRegistry,
): { entityId: string; typeId: string; partial: Record<string, unknown> } {
  const isOwner = ctx.isHost || ctx.peerSeat === privateToSeat || privateToSeat === null;
  if (isOwner) return patch;
  const fields = registry[patch.typeId];
  if (!fields) return patch;
  return { ...patch, partial: redactFields(patch.partial, fields) };
}

function redactFields(state: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  for (const f of fields) delete out[f];
  return out;
}
