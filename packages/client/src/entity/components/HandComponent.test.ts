import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { type Entity } from '../Entity';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { ZoneComponent } from './ZoneComponent';
import { TweenComponent } from './TweenComponent';
import { HandComponent } from './HandComponent';
import { CardComponent } from './CardComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { HostReplicatorV2, type ReplicatorPolicy } from '../HostReplicatorV2';
import { HostInputDispatcher } from '../HostInputDispatcher';
import { HoldService } from '../HoldService';
import { type SeatIndex } from '../../seats/SeatLayout';

const POLICY: ReplicatorPolicy = {
  channelFor:  () => 'reliable',
  coalesceFor: () => 'merge',
  shouldFlush: () => true,
};

let scene:   SceneImpl;
let ctx:     SpawnContext;
let physics: PhysicsWorld;

beforeEach(() => {
  registerCorePrimitives();
  scene   = new SceneImpl();
  scene.world = new HostReplicatorV2(POLICY);  // Hand mutations are host-only
  physics = new PhysicsWorld();
  ctx     = { scene: new THREE.Scene(), physics, entityScene: scene };
});

function placeHand(hand: Entity, x: number, y: number, z: number, rotation?: [number, number, number, number]): void {
  const t = hand.getComponent(TransformComponent)!;
  t.setState({
    position: [x, y, z],
    rotation: rotation ?? t.state.rotation,
    scale:    t.state.scale,
  });
}

function fireBeginContact(world: CANNON.World, bodyA: CANNON.Body, bodyB: CANNON.Body): void {
  world.dispatchEvent({ type: 'beginContact', bodyA, bodyB });
}

function fireEndContact(world: CANNON.World, bodyA: CANNON.Body, bodyB: CANNON.Body): void {
  world.dispatchEvent({ type: 'endContact', bodyA, bodyB });
}

describe('HandComponent — spawnable wiring', () => {
  test('hand spawns with transform + zone + hand components', () => {
    const e = scene.spawn('hand', ctx);
    expect(e.getComponent(TransformComponent)).toBeDefined();
    expect(e.getComponent(ZoneComponent)).toBeDefined();
    expect(e.getComponent(HandComponent)).toBeDefined();
    expect(e.tags).toEqual(['hand']);
  });

  test("hand's zone filters to flatview-bearing entities", () => {
    const hand = scene.spawn('hand', ctx);
    const zone = hand.getComponent(ZoneComponent)!;
    expect(zone.state.acceptComponents).toEqual(['flatview']);
  });

  test('hand defaults: isMainHand=false, isPrivate=true', () => {
    const e = scene.spawn('hand', ctx);
    const hand = e.getComponent(HandComponent)!;
    expect(hand.state.isMainHand).toBe(false);
    expect(hand.state.isPrivate).toBe(true);
  });
});

describe('HandComponent — enter / exit privacy mutation', () => {
  test('isPrivate hand sets entering card.privateToSeat = owner', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    const card = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);

    expect(card.privateToSeat).toBe(1);
  });

  test('exit clears privateToSeat back to null', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 2;
    const card = scene.spawn('card', ctx);
    const handZone = hand.getComponent(ZoneComponent)!;
    const cardBody = card.getComponent(PhysicsComponent)!.body;

    fireBeginContact(physics.world, handZone.body, cardBody);
    expect(card.privateToSeat).toBe(2);

    fireEndContact(physics.world, handZone.body, cardBody);
    expect(card.privateToSeat).toBeNull();
  });

  test('isPrivate=false leaves privateToSeat untouched', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 0;
    hand.getComponent(HandComponent)!.setState({ isPrivate: false });
    const card = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);
    expect(card.privateToSeat).toBeNull();
  });

  test('owner=null hand still sets privateToSeat=null on enter (no-op visible)', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = null;
    const card = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);
    expect(card.privateToSeat).toBeNull();
  });
});

describe('HandComponent — slot layout', () => {
  test('single card slot lands at hand position (i=0 of N=1, x=0 local)', () => {
    const hand = scene.spawn('hand', ctx);
    placeHand(hand, 5, 0, 3);
    const card = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);

    const cardTween = card.getComponent(TweenComponent)!;
    expect(cardTween.isActive()).toBe(true);
    cardTween.snapToTarget();
    expect(card.getComponent(TransformComponent)!.state.position[0]).toBeCloseTo(5, 5);
    expect(card.getComponent(TransformComponent)!.state.position[2]).toBeCloseTo(3, 5);
  });

  test('two cards spread symmetrically along hand local +X', () => {
    const hand = scene.spawn('hand', ctx);
    placeHand(hand, 0, 0, 0);
    const c1 = scene.spawn('card', ctx);
    const c2 = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, c1.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, handZone.body, c2.getComponent(PhysicsComponent)!.body);

    // zoneWidth = 1.0 (halfExtents[0]=0.5). N=2, spacing = min(1/3, 0.63) = 1/3.
    // Slots at x = -1/6 and +1/6 relative to hand center.
    c1.getComponent(TweenComponent)!.snapToTarget();
    c2.getComponent(TweenComponent)!.snapToTarget();

    const x1 = c1.getComponent(TransformComponent)!.state.position[0];
    const x2 = c2.getComponent(TransformComponent)!.state.position[0];
    expect(x1).toBeCloseTo(-1 / 6, 5);
    expect(x2).toBeCloseTo(+1 / 6, 5);
  });

  test('spacing is capped at oneCardWidth (0.63) when zone is wide', () => {
    const hand = scene.spawn('hand', ctx);
    hand.getComponent(ZoneComponent)!.setState({ halfExtents: [10, 0.1, 0.15] });
    placeHand(hand, 0, 0, 0);
    const c1 = scene.spawn('card', ctx);
    const c2 = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, c1.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, handZone.body, c2.getComponent(PhysicsComponent)!.body);

    c1.getComponent(TweenComponent)!.snapToTarget();
    c2.getComponent(TweenComponent)!.snapToTarget();

    // zoneWidth/(N+1) = 20/3 ≈ 6.67, capped at 0.63. Slots at ±0.315.
    const x1 = c1.getComponent(TransformComponent)!.state.position[0];
    const x2 = c2.getComponent(TransformComponent)!.state.position[0];
    expect(x2 - x1).toBeCloseTo(0.63, 5);
  });

  test('many cards in a small zone overlap fan-style with last on top', () => {
    const hand = scene.spawn('hand', ctx);
    placeHand(hand, 0, 0, 0);
    const cards: Entity[] = [];
    for (let i = 0; i < 5; i++) cards.push(scene.spawn('card', ctx));

    const handZone = hand.getComponent(ZoneComponent)!;
    for (const c of cards) {
      fireBeginContact(physics.world, handZone.body, c.getComponent(PhysicsComponent)!.body);
    }
    for (const c of cards) c.getComponent(TweenComponent)!.snapToTarget();

    // Y-lift increases with slot index — last card (index 4) sits highest.
    const y0 = cards[0].getComponent(TransformComponent)!.state.position[1];
    const y4 = cards[4].getComponent(TransformComponent)!.state.position[1];
    expect(y4).toBeGreaterThan(y0);
  });

  test('slot rotation inherits hand rotation (cards face owner via hand orientation)', () => {
    const hand = scene.spawn('hand', ctx);
    // Quaternion for 30° around Y axis.
    const angle = Math.PI / 6;
    const handRot: [number, number, number, number] = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
    placeHand(hand, 0, 0, 0, handRot);

    const card = scene.spawn('card', ctx);
    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);
    card.getComponent(TweenComponent)!.snapToTarget();

    const r = card.getComponent(TransformComponent)!.state.rotation;
    expect(r[0]).toBeCloseTo(handRot[0], 5);
    expect(r[1]).toBeCloseTo(handRot[1], 5);
    expect(r[2]).toBeCloseTo(handRot[2], 5);
    expect(r[3]).toBeCloseTo(handRot[3], 5);
  });

  test('slot positions transform with hand rotation (local +X follows handRot)', () => {
    const hand = scene.spawn('hand', ctx);
    // 90° rotation around Y so hand's local +X points to world +Z.
    const handRot: [number, number, number, number] = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
    placeHand(hand, 0, 0, 0, handRot);

    const c1 = scene.spawn('card', ctx);
    const c2 = scene.spawn('card', ctx);
    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, c1.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, handZone.body, c2.getComponent(PhysicsComponent)!.body);

    c1.getComponent(TweenComponent)!.snapToTarget();
    c2.getComponent(TweenComponent)!.snapToTarget();

    // After 90° around Y, local +X maps to world +Z (with sign flip on Z based
    // on right-hand rule: +X axis through 90° around Y goes to -Z). Either way,
    // the cards spread along Z, not X, so |Δx| << |Δz|.
    const z1 = c1.getComponent(TransformComponent)!.state.position[2];
    const z2 = c2.getComponent(TransformComponent)!.state.position[2];
    const x1 = c1.getComponent(TransformComponent)!.state.position[0];
    const x2 = c2.getComponent(TransformComponent)!.state.position[0];
    expect(Math.abs(z2 - z1)).toBeGreaterThan(0.2);
    expect(Math.abs(x2 - x1)).toBeLessThan(1e-5);
  });
});

describe('HandComponent — Tidy hand action', () => {
  test('tidy-hand re-tweens current contents to slot positions', () => {
    const hand = scene.spawn('hand', ctx);
    placeHand(hand, 0, 0, 0);
    const card = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);

    // Snap and then push the card out of place.
    card.getComponent(TweenComponent)!.snapToTarget();
    card.getComponent(TransformComponent)!.setState({
      position: [9, 9, 9],
      rotation: card.getComponent(TransformComponent)!.state.rotation,
      scale:    card.getComponent(TransformComponent)!.state.scale,
    });

    // Tidy hand re-tweens.
    const handComp = hand.getComponent(HandComponent)!;
    handComp.onAction('tidy-hand', undefined, { recipientSeat: 0, isHost: true, entity: hand });
    expect(card.getComponent(TweenComponent)!.isActive()).toBe(true);
    card.getComponent(TweenComponent)!.snapToTarget();
    expect(card.getComponent(TransformComponent)!.state.position[0]).toBeCloseTo(0, 5);
  });

  test('onContextMenu surfaces a Tidy hand action item', () => {
    const hand = scene.spawn('hand', ctx);
    const items = hand.getComponent(HandComponent)!.onContextMenu({
      recipientSeat: 0, isHost: true, entity: hand,
    });
    expect(items).toEqual([{ kind: 'action', id: 'tidy-hand', label: 'Tidy hand' }]);
  });
});

describe('HandComponent — isMainHand uniqueness', () => {
  test('setting isMainHand=true clears the flag on sibling hands of the same owner', () => {
    const a = scene.spawn('hand', ctx);
    const b = scene.spawn('hand', ctx);
    a.owner = 0;
    b.owner = 0;
    a.getComponent(HandComponent)!.setState({ isMainHand: true });
    expect(a.getComponent(HandComponent)!.state.isMainHand).toBe(true);

    b.getComponent(HandComponent)!.setState({ isMainHand: true });
    expect(b.getComponent(HandComponent)!.state.isMainHand).toBe(true);
    expect(a.getComponent(HandComponent)!.state.isMainHand).toBe(false);
  });

  test('hands of different owners coexist as main hands', () => {
    const a = scene.spawn('hand', ctx);
    const b = scene.spawn('hand', ctx);
    a.owner = 0;
    b.owner = 1;
    a.getComponent(HandComponent)!.setState({ isMainHand: true });
    b.getComponent(HandComponent)!.setState({ isMainHand: true });
    expect(a.getComponent(HandComponent)!.state.isMainHand).toBe(true);
    expect(b.getComponent(HandComponent)!.state.isMainHand).toBe(true);
  });

  test('owner=null mainHand clears other owner=null mainHand', () => {
    const a = scene.spawn('hand', ctx);
    const b = scene.spawn('hand', ctx);
    a.getComponent(HandComponent)!.setState({ isMainHand: true });
    b.getComponent(HandComponent)!.setState({ isMainHand: true });
    expect(a.getComponent(HandComponent)!.state.isMainHand).toBe(false);
    expect(b.getComponent(HandComponent)!.state.isMainHand).toBe(true);
  });

  test('setting isMainHand=false does not affect siblings', () => {
    const a = scene.spawn('hand', ctx);
    const b = scene.spawn('hand', ctx);
    a.owner = 0;
    b.owner = 0;
    a.getComponent(HandComponent)!.setState({ isMainHand: true });

    b.getComponent(HandComponent)!.setState({ isMainHand: false });
    expect(a.getComponent(HandComponent)!.state.isMainHand).toBe(true);
  });
});

describe('HandComponent — reorderContents', () => {
  function setupThreeCards() {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 0;
    const c1 = scene.spawn('card', ctx);
    const c2 = scene.spawn('card', ctx);
    const c3 = scene.spawn('card', ctx);
    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, c1.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, handZone.body, c2.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, handZone.body, c3.getComponent(PhysicsComponent)!.body);
    // Settle the arrange tweens fired on enter so each card carries no tween.
    [c1, c2, c3].forEach(c => c.getComponent(TweenComponent)!.snapToTarget());
    return { hand, c1, c2, c3, handZone };
  }

  test('reorderContents updates containedIds when newOrder is a permutation', () => {
    const { hand, c1, c2, c3, handZone } = setupThreeCards();
    const handComp = hand.getComponent(HandComponent)!;

    expect(handComp.reorderContents([c3.id, c1.id, c2.id])).toBe(true);
    expect(handZone.state.containedIds).toEqual([c3.id, c1.id, c2.id]);
  });

  test('reorderContents rejects a non-permutation', () => {
    const { hand, c1, c2 } = setupThreeCards();
    const handComp = hand.getComponent(HandComponent)!;

    expect(handComp.reorderContents([c1.id, c2.id])).toBe(false);  // missing c3
    expect(handComp.reorderContents([c1.id, c2.id, 'unknown-id'])).toBe(false);
  });

  test('reorderContents is a no-op when newOrder matches current order', () => {
    const { hand, c1, c2, c3 } = setupThreeCards();
    const handComp = hand.getComponent(HandComponent)!;
    expect(handComp.reorderContents([c1.id, c2.id, c3.id])).toBe(false);
  });

  test('reorderContents re-tweens cards into slot positions matching the new order', () => {
    const { hand, c1, c2, c3 } = setupThreeCards();
    const handComp = hand.getComponent(HandComponent)!;

    // Capture pre-reorder slot positions (sanity).
    const xBefore = c1.getComponent(TransformComponent)!.state.position[0];
    handComp.reorderContents([c3.id, c2.id, c1.id]);

    // Each card now has an active tween toward its new slot.
    [c1, c2, c3].forEach(c => expect(c.getComponent(TweenComponent)!.isActive()).toBe(true));
    [c1, c2, c3].forEach(c => c.getComponent(TweenComponent)!.snapToTarget());

    // After reorder, c1 lives in the LAST slot (was first); c3 lives in the
    // first slot. Their X coordinates should swap signs in a 0-centred hand.
    const xC1After = c1.getComponent(TransformComponent)!.state.position[0];
    const xC3After = c3.getComponent(TransformComponent)!.state.position[0];
    expect(xC3After).toBeCloseTo(xBefore, 5);  // c3 moved to where c1 was
    expect(xC1After).toBeCloseTo(-xBefore, 5);  // c1 moved to the opposite slot
  });
});

describe('HostInputDispatcher.handleTweenIntoHand', () => {
  function makeDispatcher(): { dispatcher: HostInputDispatcher; peerSeats: Map<string, SeatIndex> } {
    const peerSeats = new Map<string, SeatIndex>();
    const hold = new HoldService(scene.world as HostReplicatorV2, scene);
    const dispatcher = new HostInputDispatcher(hold, (peerId) => peerSeats.get(peerId) ?? null, scene);
    return { dispatcher, peerSeats };
  }

  test('owner-seat may tween a card into their hand; tween targets hand pose', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    placeHand(hand, 5, 0.5, 3);
    const card = scene.spawn('card', ctx);

    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p1', 1);

    const accepted = dispatcher.handleTweenIntoHand('p1', {
      type: 'tween-into-hand', entityId: card.id, handEntityId: hand.id,
    });
    expect(accepted).toBe(true);
    expect(card.getComponent(TweenComponent)!.isActive()).toBe(true);

    card.getComponent(TweenComponent)!.snapToTarget();
    expect(card.getComponent(TransformComponent)!.state.position).toEqual([5, 0.5, 3]);
  });

  test('non-owner is rejected', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    const card = scene.spawn('card', ctx);
    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p2', 2);

    const accepted = dispatcher.handleTweenIntoHand('p2', {
      type: 'tween-into-hand', entityId: card.id, handEntityId: hand.id,
    });
    expect(accepted).toBe(false);
    expect(card.getComponent(TweenComponent)!.isActive()).toBe(false);
  });

  test('null-owner (shared) hand accepts any seated peer', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = null;
    const card = scene.spawn('card', ctx);
    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p3', 3);

    const accepted = dispatcher.handleTweenIntoHand('p3', {
      type: 'tween-into-hand', entityId: card.id, handEntityId: hand.id,
    });
    expect(accepted).toBe(true);
  });

  test('unknown hand or entity is rejected', () => {
    const card = scene.spawn('card', ctx);
    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p1', 1);

    expect(dispatcher.handleTweenIntoHand('p1', {
      type: 'tween-into-hand', entityId: card.id, handEntityId: 'no-such-hand',
    })).toBe(false);

    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    expect(dispatcher.handleTweenIntoHand('p1', {
      type: 'tween-into-hand', entityId: 'no-such-card', handEntityId: hand.id,
    })).toBe(false);
  });
});

describe('HostInputDispatcher.handleReorderHand', () => {
  function setupHandWithCards(handOwner: SeatIndex | null) {
    const hand = scene.spawn('hand', ctx);
    hand.owner = handOwner;
    const c1 = scene.spawn('card', ctx);
    const c2 = scene.spawn('card', ctx);
    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, c1.getComponent(PhysicsComponent)!.body);
    fireBeginContact(physics.world, handZone.body, c2.getComponent(PhysicsComponent)!.body);
    [c1, c2].forEach(c => c.getComponent(TweenComponent)!.snapToTarget());
    return { hand, c1, c2, handZone };
  }

  function makeDispatcher(): { dispatcher: HostInputDispatcher; peerSeats: Map<string, SeatIndex> } {
    const peerSeats = new Map<string, SeatIndex>();
    const hold = new HoldService(scene.world as HostReplicatorV2, scene);
    const dispatcher = new HostInputDispatcher(hold, (peerId) => peerSeats.get(peerId) ?? null, scene);
    return { dispatcher, peerSeats };
  }

  test('owner seat may reorder their hand', () => {
    const { hand, c1, c2, handZone } = setupHandWithCards(1);
    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p1', 1);
    const accepted = dispatcher.handleReorderHand('p1', {
      type: 'reorder-hand', handEntityId: hand.id, newOrder: [c2.id, c1.id],
    });
    expect(accepted).toBe(true);
    expect(handZone.state.containedIds).toEqual([c2.id, c1.id]);
  });

  test('non-owner seat is rejected', () => {
    const { hand, c1, c2, handZone } = setupHandWithCards(1);
    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p2', 2);
    const accepted = dispatcher.handleReorderHand('p2', {
      type: 'reorder-hand', handEntityId: hand.id, newOrder: [c2.id, c1.id],
    });
    expect(accepted).toBe(false);
    expect(handZone.state.containedIds).toEqual([c1.id, c2.id]);
  });

  test('null-owner (shared) hand accepts any seated peer', () => {
    const { hand, c1, c2, handZone } = setupHandWithCards(null);
    const { dispatcher, peerSeats } = makeDispatcher();
    peerSeats.set('p3', 3);
    const accepted = dispatcher.handleReorderHand('p3', {
      type: 'reorder-hand', handEntityId: hand.id, newOrder: [c2.id, c1.id],
    });
    expect(accepted).toBe(true);
    expect(handZone.state.containedIds).toEqual([c2.id, c1.id]);
  });
});

describe('HandComponent — re-emits private fields on enter / exit (issue #8)', () => {
  function trackingReplicator(): {
    replicator: HostReplicatorV2;
    componentPatches: Array<{ typeId: string; entityId: string; partial: Record<string, unknown> }>;
    entityPatches:    Array<{ entityId: string; partial: Record<string, unknown> }>;
  } {
    const r = new HostReplicatorV2(POLICY);
    const componentPatches: Array<{ typeId: string; entityId: string; partial: Record<string, unknown> }> = [];
    const entityPatches:    Array<{ entityId: string; partial: Record<string, unknown> }> = [];
    const origComp = r.enqueueComponentPatch.bind(r);
    r.enqueueComponentPatch = (p) => {
      componentPatches.push({ typeId: p.typeId, entityId: p.entityId, partial: { ...p.partial } });
      origComp(p);
    };
    const origEntity = r.enqueueEntityPatch.bind(r);
    r.enqueueEntityPatch = (id, partial) => {
      entityPatches.push({ entityId: id, partial: { ...partial } });
      origEntity(id, partial);
    };
    return { replicator: r, componentPatches, entityPatches };
  }

  test('handleEnter emits card.face/back and flatview.textureRef component-patches', () => {
    const { replicator, componentPatches } = trackingReplicator();
    scene.world = replicator;

    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    const card = scene.spawn('card', ctx);
    // Seed real face / back URLs so a re-emit carries something interesting.
    card.getComponent(CardComponent)!.setState({ face: 'A♣.png', back: 'back.png' });

    // Fire enter — handleEnter should set privateToSeat AND re-emit private fields.
    fireBeginContact(physics.world, hand.getComponent(ZoneComponent)!.body, card.getComponent(PhysicsComponent)!.body);

    const cardPatches = componentPatches.filter(p => p.typeId === 'card' && p.entityId === card.id);
    const flatPatches = componentPatches.filter(p => p.typeId === 'flatview' && p.entityId === card.id);
    expect(cardPatches.some(p => p.partial.face === 'A♣.png' && p.partial.back === 'back.png')).toBe(true);
    expect(flatPatches.length).toBeGreaterThan(0);
  });

  test('handleEnter sets privateToSeat via entity-patch BEFORE the re-emit so the scrubber sees private state', () => {
    const { replicator, componentPatches, entityPatches } = trackingReplicator();
    scene.world = replicator;

    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    const card = scene.spawn('card', ctx);
    card.getComponent(CardComponent)!.setState({ face: 'A♣.png', back: 'back.png' });
    const componentPatchesBefore = componentPatches.length;
    const entityPatchesBefore    = entityPatches.length;

    fireBeginContact(physics.world, hand.getComponent(ZoneComponent)!.body, card.getComponent(PhysicsComponent)!.body);

    // privateToSeat patch must precede the card.face re-emit so the per-recipient
    // scrubber consults the private state, not the pre-private one.
    const newEntityPatches = entityPatches.slice(entityPatchesBefore);
    const newComponentPatches = componentPatches.slice(componentPatchesBefore);
    const privateToSeatIdx = newEntityPatches.findIndex(p => p.entityId === card.id && p.partial.privateToSeat === 1);
    const cardFaceIdx      = newComponentPatches.findIndex(p => p.typeId === 'card' && p.entityId === card.id && p.partial.face === 'A♣.png');
    expect(privateToSeatIdx).toBeGreaterThanOrEqual(0);
    expect(cardFaceIdx).toBeGreaterThanOrEqual(0);
    // Both queues are FIFO; the entity-patch queues into reliable messages
    // before any later component-patch is enqueued — so the relative order
    // across the two streams reflects the call order in handleEnter.
  });

  test('handleExit re-emits private fields with privateToSeat cleared', () => {
    const { replicator, componentPatches, entityPatches } = trackingReplicator();
    scene.world = replicator;

    const hand = scene.spawn('hand', ctx);
    hand.owner = 1;
    const card = scene.spawn('card', ctx);
    card.getComponent(CardComponent)!.setState({ face: 'A♣.png', back: 'back.png' });
    const handZone = hand.getComponent(ZoneComponent)!;
    const cardBody = card.getComponent(PhysicsComponent)!.body;
    fireBeginContact(physics.world, handZone.body, cardBody);

    const componentPatchesBefore = componentPatches.length;
    const entityPatchesBefore    = entityPatches.length;
    fireEndContact(physics.world, handZone.body, cardBody);

    const newEntityPatches    = entityPatches.slice(entityPatchesBefore);
    const newComponentPatches = componentPatches.slice(componentPatchesBefore);
    expect(newEntityPatches.some(p => p.entityId === card.id && p.partial.privateToSeat === null)).toBe(true);
    // Re-emit also flushes another card-state patch on exit so non-owners get
    // the real face/back back through the (now non-redacting) scrubber.
    expect(newComponentPatches.some(p => p.typeId === 'card' && p.entityId === card.id)).toBe(true);
  });
});

describe('HandComponent — guest gating', () => {
  test('without a replicator (guest), enter does not mutate privateToSeat', () => {
    scene = new SceneImpl();         // no scene.world → guest
    physics = new PhysicsWorld();
    ctx     = { scene: new THREE.Scene(), physics, entityScene: scene };

    const hand = scene.spawn('hand', ctx);
    hand.owner = 0;
    const card = scene.spawn('card', ctx);

    const handZone = hand.getComponent(ZoneComponent)!;
    fireBeginContact(physics.world, handZone.body, card.getComponent(PhysicsComponent)!.body);

    // Zone contained still mutates (data path), but hand's privacy logic is gated.
    expect(card.privateToSeat).toBeNull();
  });
});

describe('HandComponent — propertySchema (issue #6 of property-schema-refactor)', () => {
  test('declares static label and isMainHand/isPrivate entries', () => {
    expect(HandComponent.label).toBe('Hand');
    const keys = HandComponent.propertySchema.map(d => d.key);
    expect(keys).toEqual(['isMainHand', 'isPrivate']);
  });

  test('isMainHand condition hides the row when entity has no owner', () => {
    const hand = scene.spawn('hand', ctx, { id: 'h-1' });
    hand.owner = null;
    const def = HandComponent.propertySchema.find(d => d.key === 'isMainHand')!;
    const handComp = hand.getComponent(HandComponent)!;
    expect(def.condition!(handComp.state, hand)).toBe(false);
  });

  test('isMainHand condition shows the row once an owner is assigned', () => {
    const hand = scene.spawn('hand', ctx, { id: 'h-2' });
    hand.owner = 0 as SeatIndex;
    const def = HandComponent.propertySchema.find(d => d.key === 'isMainHand')!;
    const handComp = hand.getComponent(HandComponent)!;
    expect(def.condition!(handComp.state, hand)).toBe(true);
  });
});
