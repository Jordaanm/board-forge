import { describe, test, expect, beforeEach } from 'vitest';
import { SceneImpl } from '../entity/Scene';
import { Entity } from '../entity/Entity';
import { ComponentRegistry } from '../entity/ComponentRegistry';
import {
  EMPTY_PRIVATE_FIELD_REGISTRY,
  DEFAULT_PRIVATE_FIELDS,
  scrubSceneMessage,
  type PrivateFieldRegistry,
} from './PrivacyScrubber';
import { type SceneMessage } from '../entity/wire';
import { type SeatIndex } from './SeatLayout';

let scene: SceneImpl;
const lookup = (id: string) => scene.getEntity(id);

beforeEach(() => {
  scene = new SceneImpl();
  scene.setRegistry(new ComponentRegistry());
});

function spawn(id: string, privateToSeat: SeatIndex | null = null): Entity {
  const e = new Entity({ id, type: 'thing', name: id, privateToSeat });
  scene.add(e);
  return e;
}

describe('scrubSceneMessage with empty registry', () => {
  test('returns the message unchanged (identity)', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const scrubbed = scrubSceneMessage(
      { peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup,
    );
    expect(scrubbed).toBe(msg);
  });
});

describe('scrubSceneMessage component-patches with private fields', () => {
  const registry: PrivateFieldRegistry = { card: ['face'] };

  test('host always sees full state', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: true }, msg, registry, lookup);
    expect(out).toEqual(msg);
  });

  test('owner seat sees full state', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 2, isHost: false }, msg, registry, lookup);
    expect(out).toEqual(msg);
  });

  test('non-owner seat receives substituted-empty fields', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: '', back: 'red' });
  });

  test('component-patches only substitute fields that were in the partial', () => {
    spawn('a', 2);
    const registryFull: PrivateFieldRegistry = { card: ['face', 'back'] };
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      // Only `face` is present — substitution must NOT synthesise a `back` key.
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registryFull, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: '' });
  });

  test('public entity (privateToSeat = null) is not redacted', () => {
    spawn('a', null);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry, lookup);
    expect(out).toEqual(msg);
  });
});

describe('scrubSceneMessage entity-spawn with private fields', () => {
  const registry: PrivateFieldRegistry = { card: ['face'] };

  test('non-owner receives substituted-empty components', () => {
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: { card: { face: 'A♣', back: 'red' } },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry, lookup);
    expect((out as typeof msg).entity.components.card).toEqual({ face: '', back: 'red' });
  });

  test('entity-spawn substitutes every listed private field, including ones absent from the original state', () => {
    const registryFull: PrivateFieldRegistry = { card: ['face', 'back'] };
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        // Only `face` present — `back` should still be substituted on output
        // so the receiver constructs the entity without leaking missing data.
        components: { card: { face: 'A♣' } },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registryFull, lookup);
    expect((out as typeof msg).entity.components.card).toEqual({ face: '', back: '' });
  });

  test('owner seat receives full state', () => {
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: { card: { face: 'A♣', back: 'red' } },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 1, isHost: false }, msg, registry, lookup);
    expect(out).toEqual(msg);
  });
});

describe('scrubSceneMessage in-deck cards (issue #5 of issues--deck.md)', () => {
  // Manually build the deck entity with a synthetic deck component so we don't
  // have to register the full primitive/spawnable graph here.
  function spawnDeck(id: string): Entity {
    const e = new Entity({ id, type: 'deck', name: id });
    e.components.set('deck', {} as never);
    scene.add(e);
    return e;
  }

  test('in-deck card.face is scrubbed for every non-host peer', () => {
    const deck = spawnDeck('deck1');
    const card = spawn('card1', null);
    card.parentId = deck.id;
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'card1', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: '', back: '' });
  });

  test('host always sees the real face / back of an in-deck card', () => {
    const deck = spawnDeck('deck1');
    const card = spawn('card1', null);
    card.parentId = deck.id;
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'card1', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: null, isHost: true }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: 'A♣', back: 'red' });
  });

  test('a card whose parentId is null is unaffected by the deck rule', () => {
    spawn('card1', null);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'card1', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: 'A♣' });
  });

  test('a card whose parent is not a deck is unaffected', () => {
    const parent = new Entity({ id: 'p', type: 'box', name: 'p' });
    scene.add(parent);
    const card = spawn('card1', null);
    card.parentId = parent.id;
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'card1', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: 'A♣' });
  });

  test('the deck entity itself is not scrubbed (mesh.textureRefs stays public)', () => {
    spawnDeck('deck1');
    // mesh isn't in the registry — confirms deck mesh top/bottom slots stay public.
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{
        entityId: 'deck1',
        typeId:   'mesh',
        partial:  { textureRefs: { face: 'top.png', back: 'bot.png', side: '' } },
      }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect(out).toEqual(msg);
  });
});

describe('DEFAULT_PRIVATE_FIELDS — face / back / textureRef coverage', () => {
  test('blanks card.face, card.back, and flatview.textureRef for non-owners', () => {
    spawn('a', 1);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [
        { entityId: 'a', typeId: 'card',     partial: { face: 'F.png', back: 'B.png', category: 'spades' } },
        { entityId: 'a', typeId: 'flatview', partial: { textureRef: 'F.png' } },
      ],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: '', back: '', category: 'spades' });
    expect((out as typeof msg).patches[1].partial).toEqual({ textureRef: '' });
  });

  test('owner seat sees the real face / back / textureRef values', () => {
    spawn('a', 1);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [
        { entityId: 'a', typeId: 'card',     partial: { face: 'F.png', back: 'B.png' } },
        { entityId: 'a', typeId: 'flatview', partial: { textureRef: 'F.png' } },
      ],
    };
    const out = scrubSceneMessage({ peerSeat: 1, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).patches[0].partial).toEqual({ face: 'F.png', back: 'B.png' });
    expect((out as typeof msg).patches[1].partial).toEqual({ textureRef: 'F.png' });
  });

  test('entity-spawn for a private card scrubs face / back / textureRef on non-owner construction', () => {
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: {
          card:     { face: 'F.png', back: 'B.png', category: 'spades' },
          flatview: { textureRef: 'F.png' },
          mesh:     { meshRef: 'prim:card', textureRefs: { face: 'F.png', back: 'B.png' }, tint: '#fff', size: [0.63, 0.01, 0.88] },
        },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect((out as typeof msg).entity.components.card).toEqual({ face: '', back: '', category: 'spades' });
    expect((out as typeof msg).entity.components.flatview).toEqual({ textureRef: '' });
    // Mesh state isn't in the registry; left as-is. CardComponent's downstream
    // pushTexturesToMesh on the receiver is what overwrites the rendered face.
    expect((out as typeof msg).entity.components.mesh).toEqual(msg.entity.components.mesh);
  });
});
