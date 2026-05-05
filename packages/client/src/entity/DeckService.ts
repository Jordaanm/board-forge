// Host-only operations on Decks. Issue #6 of issues--deck.md (Draw +
// singleton dissolve). Issue #7 (Shuffle) and #9 (Deal) extend it.
//
// Each verb here mutates host state, fires through the replicator, and
// triggers any required tweens. Authority gating (canManipulate / has-main-hand)
// happens at the call site (HostInputDispatcher / dispatchMenuAction) before
// reaching this service.

import * as THREE from 'three';
import { type SceneImpl } from './Scene';
import { type Entity } from './Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { type HostReplicatorV2 } from './HostReplicatorV2';
import { DeckComponent } from './components/DeckComponent';
import { CardComponent } from './components/CardComponent';
import { TransformComponent } from './components/TransformComponent';
import { TweenComponent } from './components/TweenComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { HandComponent } from './components/HandComponent';

export interface DeckHostFacade {
  despawn(entityId: string): void;
}

const TWEEN_INTO_HAND_MS = 250;
const SHUFFLE_JITTER_MS  = 200;
// Y-axis rotation magnitude for the shuffle jitter (radians). ~10 degrees.
const SHUFFLE_JITTER_RAD = 0.18;

export class DeckService {
  constructor(
    private readonly scene:      SceneImpl,
    private readonly replicator: HostReplicatorV2,
    private readonly host:       DeckHostFacade,
  ) {}

  // Pops `min(count, deck.cards.length)` cards from the front of the deck and
  // tweens each into the caller's main hand. After the loop, `maybeDissolve`
  // checks whether the deck has shrunk to a singleton and, if so, un-hides the
  // lone card and despawns the deck. Returns the number of cards drawn.
  drawFromDeck(deckId: string, count: number, callerSeat: SeatIndex | null): number {
    if (count <= 0 || callerSeat === null) return 0;
    const deck = this.scene.getEntity(deckId);
    if (!deck) return 0;
    const deckC = deck.getComponent(DeckComponent);
    if (!deckC) return 0;

    const handId = mainHandIdFor(this.scene, callerSeat);
    if (!handId) return 0;
    const hand = this.scene.getEntity(handId);
    if (!hand) return 0;

    const popN = Math.min(count, deckC.state.cards.length);
    if (popN === 0) return 0;

    const popped = deckC.state.cards.slice(0, popN);
    const remaining = deckC.state.cards.slice(popN);
    deckC.setState({ cards: remaining });

    const deckTransform = deck.getComponent(TransformComponent)!;
    const deckPos = deckTransform.state.position;
    const deckRot = deckTransform.state.rotation;
    const handTransform = hand.getComponent(TransformComponent);
    const handPos = handTransform?.state.position ?? deckPos;

    for (const cardId of popped) {
      const card = this.scene.getEntity(cardId);
      if (!card) continue;
      this.releaseCardFromDeck(card, deckPos, deckRot);
      // Tween to the hand's centre. The hand's zone beginContact then runs
      // the existing slot-arrange / privacy-set flow.
      const tween = card.getComponent(TweenComponent);
      if (tween) {
        tween.tweenTo({ position: [handPos[0], handPos[1], handPos[2]] }, TWEEN_INTO_HAND_MS);
      }
    }

    this.maybeDissolve(deckId);
    return popN;
  }

  // Fisher-Yates shuffle on the deck's `cards`, plus a brief rotation jitter
  // tween for visual feedback. Issue #7 of issues--deck.md.
  shuffleDeck(deckId: string): boolean {
    const deck = this.scene.getEntity(deckId);
    if (!deck) return false;
    const deckC = deck.getComponent(DeckComponent);
    if (!deckC) return false;
    if (deckC.state.cards.length < 2) {
      // Nothing meaningful to shuffle; still play the jitter for parity.
      this.playShuffleJitter(deck);
      return true;
    }
    const shuffled = fisherYates([...deckC.state.cards]);
    deckC.setState({ cards: shuffled });
    this.playShuffleJitter(deck);
    return true;
  }

  private playShuffleJitter(deck: Entity): void {
    const transform = deck.getComponent(TransformComponent);
    const tween     = deck.getComponent(TweenComponent);
    if (!transform || !tween) return;
    const [qx, qy, qz, qw] = transform.state.rotation;
    const cur = new THREE.Quaternion(qx, qy, qz, qw);
    const dq  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SHUFFLE_JITTER_RAD);
    const target = cur.clone().multiply(dq);
    const pos = transform.state.position;
    tween.tweenTo({
      position: [pos[0], pos[1], pos[2]],
      rotation: [target.x, target.y, target.z, target.w],
    }, SHUFFLE_JITTER_MS);
  }

  // If the deck has exactly 1 card left, un-hide that card at the deck's
  // current pose with zero velocity, then despawn the deck. No-op otherwise.
  maybeDissolve(deckId: string): boolean {
    const deck = this.scene.getEntity(deckId);
    if (!deck) return false;
    const deckC = deck.getComponent(DeckComponent);
    if (!deckC) return false;
    if (deckC.state.cards.length !== 1) return false;

    const loneId = deckC.state.cards[0];
    const lone = this.scene.getEntity(loneId);
    if (!lone) {
      // Card already gone — drop the deck as a defensive cleanup.
      this.host.despawn(deckId);
      return true;
    }

    const deckTransform = deck.getComponent(TransformComponent)!;
    this.releaseCardFromDeck(lone, deckTransform.state.position, deckTransform.state.rotation);
    const phys = lone.getComponent(PhysicsComponent);
    if (phys?.body) {
      phys.body.velocity.setZero();
      phys.body.angularVelocity.setZero();
    }

    this.host.despawn(deckId);
    return true;
  }

  // Shared between draw and dissolve: clears isContained / parentId, snaps
  // transform to the deck's pose, then re-emits face/back so the privacy
  // scrubber recomputes audience now that parentId is null.
  private releaseCardFromDeck(
    card:    Entity,
    pos:     readonly [number, number, number],
    rot:     readonly [number, number, number, number],
  ): void {
    if (card.isContained) {
      card.isContained = false;
      for (const comp of card.components.values()) comp.onIsContainedChanged(false);
      this.replicator.enqueueEntityPatch(card.id, { isContained: false });
    }
    if (card.parentId !== null) {
      card.parentId = null;
      this.replicator.enqueueEntityPatch(card.id, { parentId: null });
    }
    const transform = card.getComponent(TransformComponent);
    if (transform) {
      transform.setState({
        position: [pos[0], pos[1], pos[2]],
        rotation: [rot[0], rot[1], rot[2], rot[3]],
        scale:    transform.state.scale,
      });
    }
    const phys = card.getComponent(PhysicsComponent);
    if (phys?.body) {
      phys.body.position.set(pos[0], pos[1], pos[2]);
      phys.body.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
    }
    const cardC = card.getComponent(CardComponent);
    if (cardC) {
      // Re-emit face/back so peers receive real values now that the deck-
      // privacy rule no longer applies.
      cardC.setState({ face: cardC.state.face, back: cardC.state.back });
    }
  }
}

function fisherYates<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Returns the entity id of the seat's main hand, or null if none exists.
export function mainHandIdFor(scene: SceneImpl, seat: SeatIndex): string | null {
  for (const e of scene.all()) {
    if (e.owner !== seat) continue;
    const hand = e.getComponent(HandComponent);
    if (hand?.state.isMainHand) return e.id;
  }
  return null;
}
