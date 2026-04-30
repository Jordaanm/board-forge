// Host-side handler for inbound guest messages on the scene channel.
// Slice #6 of planning/issues/issues--scene-graph.md — pulls the validation
// logic out of ThreeCanvas so OwnershipPolicy + HoldService coordination is
// independently testable.
//
// Responsibility split:
//   * GuestInputHandler  — guest-drag-move position streams (no policy gate;
//                          gating happens through entity.heldBy ownership).
//   * HostInputDispatcher — scene-channel RPCs (hold-claim / hold-release /
//                          request-update) that do gate on OwnershipPolicy.

import { Scene } from './Scene';
import { type SeatIndex } from '../seats/SeatLayout';
import { canManipulate } from '../seats/OwnershipPolicy';
import { type HoldService } from './HoldService';
import { type HoldClaim, type HoldRelease, type RequestUpdate } from './wire';

export class HostInputDispatcher {
  constructor(
    private readonly hold:        HoldService,
    private readonly getPeerSeat: (peerId: string) => SeatIndex | null,
  ) {}

  // Returns true on accept (entity claimed and broadcast). False on any
  // refusal: unknown entity, ownership refused, already held.
  handleHoldClaim(_peerId: string, msg: HoldClaim): boolean {
    const entity = Scene.getEntity(msg.entityId);
    if (!entity) return false;
    if (!canManipulate({ peerSeat: msg.seat, isHost: false }, entity.owner)) return false;
    return this.hold.tryClaim(entity, msg.seat);
  }

  handleHoldRelease(peerId: string, msg: HoldRelease): boolean {
    const entity = Scene.getEntity(msg.entityId);
    if (!entity) return false;
    const senderSeat = this.getPeerSeat(peerId);
    if (senderSeat === null || entity.heldBy !== senderSeat) return false;
    const vel = (msg.vx !== undefined || msg.vy !== undefined || msg.vz !== undefined)
      ? { vx: msg.vx ?? 0, vy: msg.vy ?? 0, vz: msg.vz ?? 0 }
      : undefined;
    this.hold.release(entity, vel);
    return true;
  }

  handleRequestUpdate(peerId: string, msg: RequestUpdate): boolean {
    const entity = Scene.getEntity(msg.entityId);
    if (!entity) return false;
    const senderSeat = this.getPeerSeat(peerId);
    if (!canManipulate({ peerSeat: senderSeat, isHost: false }, entity.owner)) return false;
    const comp = entity.components.get(msg.typeId);
    if (!comp) return false;
    comp.setState(msg.partial);
    return true;
  }
}
