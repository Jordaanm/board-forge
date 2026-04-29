// Per-recipient scrubbing seam for SceneState replication.
// MVP: identity. PRD-2 will register `private` fields per object type and
// this function will redact them based on the recipient's seat / host status.

import { type SeatIndex } from './SeatLayout';

export interface RecipientContext {
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

export interface PrivateFieldRegistry {
  // Maps objectType → field names to redact for non-owner recipients.
  // Empty in this MVP; PRD-2 (cards / hands) populates it.
  readonly [objectType: string]: readonly string[] | undefined;
}

export const EMPTY_PRIVATE_FIELD_REGISTRY: PrivateFieldRegistry = Object.freeze({});

export function scrubFor<T>(
  _ctx:     RecipientContext,
  entity:   T,
  registry: PrivateFieldRegistry,
): T {
  if (Object.keys(registry).length === 0) return entity;
  return entity;
}
