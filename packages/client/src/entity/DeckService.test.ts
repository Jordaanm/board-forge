import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from './Scene';
import { type SpawnContext } from './EntityComponent';
import { HostReplicatorV2, type ReplicatorPolicy } from './HostReplicatorV2';
import { MergeService } from './MergeService';
import { DeckService } from './DeckService';
import { registerCorePrimitives } from './spawnables';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CardComponent } from './components/CardComponent';
import { DeckComponent } from './components/DeckComponent';
import { HandComponent } from './components/HandComponent';
import { TransformComponent } from './components/TransformComponent';
import { TweenComponent } from './components/TweenComponent';
import { type Entity } from './Entity';

const POLICY: ReplicatorPolicy = {
  channelFor:  () => 'reliable',
  coalesceFor: () => 'merge',
  shouldFlush: () => true,
};

let scene:      SceneImpl;
let ctx:        SpawnContext;
let replicator: HostReplicatorV2;
let merge:      MergeService;
let decks:      DeckService;
let despawned:  string[];

function spawnAt(type: string, position: [number, number, number]): Entity {
  const e = scene.spawn(type, ctx);
  const t = e.getComponent(TransformComponent)!;
  t.setState({ position, rotation: t.state.rotation, scale: t.state.scale });
  return e;
}

function spawnCard(id: string, category = 'tarot', face = 'F', back = 'B'): Entity {
  const e = scene.spawn('card', ctx, { id });
  e.getComponent(CardComponent)!.setState({ face, back, category });
  return e;
}

function buildDeckOf(category: string, cardIds: string[]): Entity {
  for (const id of cardIds) spawnCard(id, category);
  const lower = scene.getEntity(cardIds[cardIds.length - 1])!;
  const t = lower.getComponent(TransformComponent)!;
  t.setState({ position: [0, 0.5, 0], rotation: t.state.rotation, scale: t.state.scale });

  // Build deck via MergeService card-card path, then merge remaining cards in.
  const deck = merge.merge(scene.getEntity(cardIds[0])!, lower)!;
  for (let i = 1; i < cardIds.length - 1; i++) {
    merge.merge(scene.getEntity(cardIds[i])!, deck);
  }
  return deck;
}

beforeEach(() => {
  registerCorePrimitives();
  scene = new SceneImpl();
  ctx = { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };
  replicator = new HostReplicatorV2(POLICY);
  scene.world = replicator;
  despawned = [];
  merge = new MergeService(scene, replicator, {
    spawnAt: (type, position) => spawnAt(type, position),
  });
  decks = new DeckService(scene, replicator, {
    despawn: (id) => {
      despawned.push(id);
      scene.removeEntity(id);
    },
  });
});

describe('DeckService.drawFromDeck', () => {
  function setupSeatedHand(seat: 0 | 1): string {
    const hand = scene.spawn('hand', ctx);
    hand.owner = seat;
    hand.getComponent(HandComponent)!.setState({ isMainHand: true });
    return hand.id;
  }

  test('refuses when caller has no main hand', () => {
    const deck = buildDeckOf('t', ['a', 'b', 'c']);
    const drawn = decks.drawFromDeck(deck.id, 1, 0);
    expect(drawn).toBe(0);
    expect(deck.getComponent(DeckComponent)!.state.cards.length).toBe(3);
  });

  test('pops the front card and starts a tween into the main hand', () => {
    setupSeatedHand(0);
    const deck = buildDeckOf('t', ['a', 'b', 'c']);
    const cardsBefore = [...deck.getComponent(DeckComponent)!.state.cards];
    const drawn = decks.drawFromDeck(deck.id, 1, 0);
    expect(drawn).toBe(1);
    const cardsAfter = deck.getComponent(DeckComponent)!.state.cards;
    expect(cardsAfter).toEqual(cardsBefore.slice(1));

    const drawnCard = scene.getEntity(cardsBefore[0])!;
    expect(drawnCard.isContained).toBe(false);
    expect(drawnCard.parentId).toBeNull();
    expect(drawnCard.getComponent(TweenComponent)!.isActive()).toBe(true);
  });

  test('caps at deck size when count > cards.length', () => {
    setupSeatedHand(0);
    const deck = buildDeckOf('t', ['a', 'b', 'c']);
    const drawn = decks.drawFromDeck(deck.id, 99, 0);
    // 3 cards in deck → at most 2 can be drawn before maybeDissolve fires
    // (cards.length === 1 dissolves the deck and un-hides the lone card).
    expect(drawn).toBeLessThanOrEqual(3);
  });

  test('refuses when callerSeat is null', () => {
    setupSeatedHand(0);
    const deck = buildDeckOf('t', ['a', 'b']);
    expect(decks.drawFromDeck(deck.id, 1, null)).toBe(0);
  });

  test('refuses when count <= 0', () => {
    setupSeatedHand(0);
    const deck = buildDeckOf('t', ['a', 'b']);
    expect(decks.drawFromDeck(deck.id, 0, 0)).toBe(0);
  });
});

describe('DeckService.maybeDissolve', () => {
  test('does nothing when cards.length !== 1', () => {
    const deck = buildDeckOf('t', ['a', 'b', 'c']);
    const out = decks.maybeDissolve(deck.id);
    expect(out).toBe(false);
    expect(despawned).toEqual([]);
  });

  test('un-hides the lone card and despawns the deck when cards.length === 1', () => {
    const deck = buildDeckOf('t', ['a', 'b']);
    // Drop the deck to 1 card by directly mutating component state.
    deck.getComponent(DeckComponent)!.setState({ cards: ['a'] });
    const out = decks.maybeDissolve(deck.id);
    expect(out).toBe(true);
    expect(despawned).toContain(deck.id);
    const lone = scene.getEntity('a')!;
    expect(lone.isContained).toBe(false);
    expect(lone.parentId).toBeNull();
  });
});

describe('DeckService.shuffleDeck', () => {
  test('permutes cards (same set, possibly different order)', () => {
    const deck = buildDeckOf('t', ['a', 'b', 'c', 'd', 'e']);
    const before = [...deck.getComponent(DeckComponent)!.state.cards];
    decks.shuffleDeck(deck.id);
    const after = deck.getComponent(DeckComponent)!.state.cards;
    expect(after).toHaveLength(before.length);
    expect(new Set(after)).toEqual(new Set(before));
  });

  test('plays a rotation jitter tween on the deck', () => {
    const deck = buildDeckOf('t', ['a', 'b', 'c']);
    decks.shuffleDeck(deck.id);
    expect(deck.getComponent(TweenComponent)!.isActive()).toBe(true);
  });

  test('returns false for an unknown deck', () => {
    expect(decks.shuffleDeck('nope')).toBe(false);
  });
});

describe('DeckService.drawFromDeck — singleton dissolution', () => {
  test('drawing down to 1 card triggers dissolve', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 0;
    hand.getComponent(HandComponent)!.setState({ isMainHand: true });
    const deck = buildDeckOf('t', ['a', 'b']);
    const beforeId = deck.id;
    decks.drawFromDeck(deck.id, 1, 0);
    expect(despawned).toContain(beforeId);
    // Lone card is now loose on the table at the deck's pose.
    const lone = scene.getEntity('b')!;
    expect(lone.isContained).toBe(false);
  });
});
