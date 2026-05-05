import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { CardComponent } from './CardComponent';
import { DeckComponent, CARD_SLAB_HEIGHT, CARD_MASS } from './DeckComponent';
import { HandComponent } from './HandComponent';
import { MeshComponent } from './MeshComponent';
import { PhysicsComponent } from './PhysicsComponent';

let scene: SceneImpl;
let ctx: SpawnContext;

beforeEach(() => {
  registerCorePrimitives();
  scene = new SceneImpl();
  ctx = { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };
});

function spawnCard(id: string, face: string, back: string, category: string = 'x') {
  const c = scene.spawn('card', ctx, { id });
  c.getComponent(CardComponent)!.setState({ face, back, category });
  return c;
}

describe('DeckComponent — patches mesh on cards change', () => {
  test('size.height grows to 0.02 × cards.length', () => {
    spawnCard('a', 'face-A', 'back-A');
    spawnCard('b', 'face-B', 'back-B');
    const deck = scene.spawn('deck', ctx);
    deck.getComponent(DeckComponent)!.setState({ cards: ['a', 'b'], category: 'x' });
    const size = deck.getComponent(MeshComponent)!.state.size as [number, number, number];
    expect(size[1]).toBeCloseTo(CARD_SLAB_HEIGHT * 2);
  });

  test('textureRefs.face = top card face, .back = bottom card back', () => {
    spawnCard('top', 'face-TOP', 'back-TOP');
    spawnCard('bot', 'face-BOT', 'back-BOT');
    const deck = scene.spawn('deck', ctx);
    deck.getComponent(DeckComponent)!.setState({ cards: ['top', 'bot'], category: '' });
    const slots = deck.getComponent(MeshComponent)!.state.textureRefs;
    expect(slots.face).toBe('face-TOP');
    expect(slots.back).toBe('back-BOT');
  });

  test('mass = cardMass × cards.length', () => {
    spawnCard('a', '', '');
    spawnCard('b', '', '');
    spawnCard('c', '', '');
    const deck = scene.spawn('deck', ctx);
    deck.getComponent(DeckComponent)!.setState({ cards: ['a', 'b', 'c'], category: '' });
    const phys = deck.getComponent(PhysicsComponent)!;
    expect(phys.state.mass).toBeCloseTo(CARD_MASS * 3);
    expect(phys.body.mass).toBeCloseTo(CARD_MASS * 3);
  });

  test('empty cards is a no-op (size unchanged)', () => {
    const deck = scene.spawn('deck', ctx);
    const before = deck.getComponent(MeshComponent)!.state.size;
    deck.getComponent(DeckComponent)!.setState({ cards: [], category: '' });
    const after = deck.getComponent(MeshComponent)!.state.size;
    expect(after).toEqual(before);
  });
});

describe('DeckComponent — context menu', () => {
  test('returns "Draw" action greyed out when caller has no main hand, plus Shuffle', () => {
    const deck = scene.spawn('deck', ctx);
    const items = deck.getComponent(DeckComponent)!.onContextMenu({
      recipientSeat: 0, isHost: true, entity: deck,
    });
    const draw = items.find(i => i.kind === 'action' && (i as { id: string }).id === 'draw') as
      | { kind: string; id: string; label: string; disabled?: boolean }
      | undefined;
    expect(draw).toBeDefined();
    expect(draw!.label).toBe('Draw');
    expect(draw!.disabled).toBe(true);
    expect(items.some(i => i.kind === 'action' && (i as { id: string }).id === 'shuffle')).toBe(true);
  });

  test('"Draw" is a submenu (not a disabled action) when caller has a main hand', () => {
    const hand = scene.spawn('hand', ctx);
    hand.owner = 0;
    hand.getComponent(HandComponent)!.setState({ isMainHand: true });
    const deck = scene.spawn('deck', ctx);
    const items = deck.getComponent(DeckComponent)!.onContextMenu({
      recipientSeat: 0, isHost: true, entity: deck,
    });
    const drawSub = items.find(i => i.kind === 'submenu' && (i as { label: string }).label === 'Draw');
    expect(drawSub).toBeDefined();
    const sub = drawSub as { kind: string; label: string; items: Array<{ kind: string; id: string; label: string }> };
    expect(sub.items.map(i => i.label)).toEqual(['1', '2', '3', '5', 'Other…']);
  });

  test('"Draw" is greyed out when recipientSeat is null', () => {
    const deck = scene.spawn('deck', ctx);
    const items = deck.getComponent(DeckComponent)!.onContextMenu({
      recipientSeat: null, isHost: true, entity: deck,
    });
    const draw = items.find(i => i.kind === 'action' && (i as { id: string }).id === 'draw') as
      | { disabled?: boolean }
      | undefined;
    expect(draw?.disabled).toBe(true);
  });

  test('always includes a "Shuffle" action', () => {
    const deck = scene.spawn('deck', ctx);
    const items = deck.getComponent(DeckComponent)!.onContextMenu({
      recipientSeat: null, isHost: true, entity: deck,
    });
    const shuf = items.find(i => i.kind === 'action' && (i as { id: string }).id === 'shuffle') as
      | { label: string }
      | undefined;
    expect(shuf?.label).toBe('Shuffle');
  });
});

