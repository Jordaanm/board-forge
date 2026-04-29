// Pure predicate gating who may manipulate a scene-graph entity.
// Consumed by drag controllers, RPC handlers, and context menus once
// scene-graph lands. See planning/prd--seats-MVP.md.

import { type SeatIndex } from './SeatLayout';

export interface ManipulatorContext {
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

export function canManipulate(
  ctx: ManipulatorContext,
  entityOwner: SeatIndex | null,
): boolean {
  if (ctx.isHost)             return true;
  if (ctx.peerSeat === null)  return false;
  if (entityOwner === null)   return true;
  return entityOwner === ctx.peerSeat;
}
