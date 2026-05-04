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

import { type SceneImpl } from './Scene';
import { type SeatIndex } from '../seats/SeatLayout';
import { canManipulate } from '../seats/OwnershipPolicy';
import { type HoldService } from './HoldService';
import { type HoldClaim, type HoldRelease, type InvokeAction, type RequestUpdate, type ApplyImpulse } from './wire';
import { type ActionContext } from './EntityComponent';
import { PhysicsComponent } from './components/PhysicsComponent';

export class HostInputDispatcher {
  constructor(
    private readonly hold:        HoldService,
    private readonly getPeerSeat: (peerId: string) => SeatIndex | null,
    private readonly scene:       SceneImpl,
  ) {}

  // Returns true on accept (entity claimed and broadcast). False on any
  // refusal: unknown entity, ownership refused, already held.
  handleHoldClaim(_peerId: string, msg: HoldClaim): boolean {
    const entity = this.scene.getEntity(msg.entityId);
    if (!entity) return false;
    if (!canManipulate({ peerSeat: msg.seat, isHost: false }, entity.owner)) return false;
    return this.hold.tryClaim(entity, msg.seat);
  }

  handleHoldRelease(peerId: string, msg: HoldRelease): boolean {
    const entity = this.scene.getEntity(msg.entityId);
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
    const entity = this.scene.getEntity(msg.entityId);
    if (!entity) return false;
    const senderSeat = this.getPeerSeat(peerId);
    if (!canManipulate({ peerSeat: senderSeat, isHost: false }, entity.owner)) return false;
    const comp = entity.components.get(msg.typeId);
    if (!comp) return false;
    comp.setState(msg.partial);
    return true;
  }

  // Slice #7 — guest clicks an entity's context-menu action. Host validates
  // ownership, looks up the targeted component, runs `onAction(...)` on it.
  handleInvokeAction(peerId: string, msg: InvokeAction): boolean {
    const entity = this.scene.getEntity(msg.entityId);
    if (!entity) return false;
    const senderSeat = this.getPeerSeat(peerId);
    if (!canManipulate({ peerSeat: senderSeat, isHost: false }, entity.owner)) return false;
    const comp = entity.components.get(msg.componentTypeId);
    if (!comp) return false;
    const ctx: ActionContext = { recipientSeat: senderSeat, isHost: false, entity };
    comp.onAction(msg.actionId, msg.args, ctx);
    return true;
  }

  // Issue #5a of issues--tools.md — guest's FlickTool fires an impulse.
  // Host re-validates `canManipulate` + `!isLocked` before applying.
  handleApplyImpulse(peerId: string, msg: ApplyImpulse): boolean {
    const entity = this.scene.getEntity(msg.entityId);
    if (!entity) return false;
    const senderSeat = this.getPeerSeat(peerId);
    if (!canManipulate({ peerSeat: senderSeat, isHost: false }, entity.owner)) return false;
    const phys = entity.getComponent(PhysicsComponent);
    if (!phys) return false;
    if (phys.state.isLocked) return false;
    phys.applyImpulse({ x: msg.vx, y: msg.vy, z: msg.vz });
    return true;
  }
}
