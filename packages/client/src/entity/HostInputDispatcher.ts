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
import { type Entity } from './Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { canManipulate } from '../seats/OwnershipPolicy';
import { type HoldService } from './HoldService';
import { type HoldClaim, type HoldRelease, type InvokeAction, type RequestUpdate, type ApplyImpulse, type PlayCardToTable, type ReorderHand, type TweenIntoHand } from './wire';
import { type ActionContext } from './EntityComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { TweenComponent } from './components/TweenComponent';
import { ZoneComponent } from './components/ZoneComponent';
import { HandComponent } from './components/HandComponent';
import { TransformComponent } from './components/TransformComponent';

const PLAY_TO_TABLE_TWEEN_MS = 250;
const TWEEN_INTO_HAND_MS     = 250;

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

  // Issue #5 of issues--hand.md — guest drags a tile out of the hand panel
  // onto the canvas. Sender's seat must own the containing hand (or the hand
  // is shared / null-owner) and the entity must have a TweenComponent.
  handlePlayCardToTable(peerId: string, msg: PlayCardToTable): boolean {
    const senderSeat = this.getPeerSeat(peerId);
    if (senderSeat === null) return false;
    const entity = this.scene.getEntity(msg.entityId);
    if (!entity) return false;
    const hand = findContainingHand(this.scene, entity.id);
    if (!hand) return false;
    if (hand.owner !== null && hand.owner !== senderSeat) return false;
    const tween = entity.getComponent(TweenComponent);
    if (!tween) return false;
    tween.tweenTo({ position: [msg.x, msg.y, msg.z] }, PLAY_TO_TABLE_TWEEN_MS);
    return true;
  }

  // Issue #6 of issues--hand.md — guest drags a tile within the hand panel
  // to reorder the hand. HandComponent.reorderContents validates the
  // permutation and re-arranges 3D slots; replication carries the new order
  // to all peers.
  handleReorderHand(peerId: string, msg: ReorderHand): boolean {
    const senderSeat = this.getPeerSeat(peerId);
    if (senderSeat === null) return false;
    const hand = this.scene.getEntity(msg.handEntityId);
    if (!hand) return false;
    if (hand.owner !== null && hand.owner !== senderSeat) return false;
    const handComp = hand.getComponent(HandComponent);
    if (!handComp) return false;
    return handComp.reorderContents(msg.newOrder);
  }

  // Issue #7 of issues--hand.md — guest releases a 3D-grabbed entity over
  // the hand panel. Host tweens the entity to the hand's centre; the zone's
  // beginContact then triggers HandComponent's slot logic. Sender's seat
  // must own the destination hand (or it's null-owner / shared).
  handleTweenIntoHand(peerId: string, msg: TweenIntoHand): boolean {
    const senderSeat = this.getPeerSeat(peerId);
    if (senderSeat === null) return false;
    const hand = this.scene.getEntity(msg.handEntityId);
    if (!hand) return false;
    if (hand.owner !== null && hand.owner !== senderSeat) return false;
    const entity = this.scene.getEntity(msg.entityId);
    if (!entity) return false;
    const tween = entity.getComponent(TweenComponent);
    if (!tween) return false;
    const handPose = hand.getComponent(TransformComponent)?.state.position;
    if (!handPose) return false;
    tween.tweenTo({ position: [handPose[0], handPose[1], handPose[2]] }, TWEEN_INTO_HAND_MS);
    return true;
  }
}

// Walks every Hand entity and returns the one whose zone currently contains
// `cardId`. Returns null if the card is not in any hand. Linear scan; fine
// for PoC scale.
export function findContainingHand(scene: SceneImpl, cardId: string): Entity | null {
  for (const e of scene.all()) {
    if (!e.getComponent(HandComponent)) continue;
    const zone = e.getComponent(ZoneComponent);
    if (zone?.state.containedIds.includes(cardId)) return e;
  }
  return null;
}
