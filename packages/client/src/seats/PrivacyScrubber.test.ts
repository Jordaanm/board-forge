import { describe, test, expect, beforeEach } from 'vitest';
import { SceneImpl } from '../entity/Scene';
import { Entity } from '../entity/Entity';
import { ComponentRegistry } from '../entity/ComponentRegistry';
import {
  EMPTY_PRIVATE_FIELD_REGISTRY,
  DEFAULT_PRIVATE_FIELDS,
  scrubSceneMessage,
  isFilteredFor,
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
  test('public entity → identity (no field redaction, no entity filter)', () => {
    spawn('a', null);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const scrubbed = scrubSceneMessage(
      { peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup,
    );
    expect(scrubbed).toEqual(msg);
  });

  test('private entity is still entity-filtered even with empty registry', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const scrubbed = scrubSceneMessage(
      { peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup,
    );
    expect(scrubbed).toBeNull();
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

  test('non-owner: privateToSeat≠recipient → patch is filtered out entirely (full-entity rule)', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry, lookup);
    expect(out).toBeNull();
  });

  test('component-patches: filter survivors keep field-redaction for the deck rule', () => {
    spawn('a', null);
    const registryFull: PrivateFieldRegistry = { card: ['face', 'back'] };
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      // public entity, private fields — only 'face' present so back stays absent
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registryFull, lookup);
    // Public, non-deck → unchanged.
    expect((out as typeof msg).patches[0].partial).toEqual({ face: 'A♣' });
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

describe('scrubSceneMessage entity-spawn (private to specific seat)', () => {
  const registry: PrivateFieldRegistry = { card: ['face'] };

  test('non-owner: spawn for a privateToSeat entity is filtered entirely', () => {
    spawn('a', 1); // entity must be in the scene for the filter walk to find privateToSeat
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: { card: { face: 'A♣', back: 'red' } },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry, lookup);
    expect(out).toBeNull();
  });

  test('owner seat receives full state (filter false; field-redaction skipped on owner)', () => {
    spawn('a', 1);
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

  test('host always receives full state regardless of privateToSeat', () => {
    spawn('a', 1);
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: { card: { face: 'A♣', back: 'red' } },
      },
    };
    const out = scrubSceneMessage({ peerSeat: null, isHost: true }, msg, registry, lookup);
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

describe('DEFAULT_PRIVATE_FIELDS — full filtering for self-private + deck redaction for ancestor=deck', () => {
  test('private card patches are filtered entirely for non-owners (whole-entity rule)', () => {
    spawn('a', 1);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [
        { entityId: 'a', typeId: 'card',     partial: { face: 'F.png', back: 'B.png', category: 'spades' } },
        { entityId: 'a', typeId: 'flatview', partial: { textureRef: 'F.png' } },
      ],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect(out).toBeNull();
  });

  test('owner sees the real face / back / textureRef values', () => {
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

  test('entity-spawn for a private card is filtered entirely on non-owner', () => {
    spawn('a', 1);
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: {
          card:     { face: 'F.png', back: 'B.png', category: 'spades' },
          flatview: { textureRef: 'F.png' },
          mesh:     { meshRef: 'prim:card', textureRefs: { face: 'F.png', back: 'B.png' }, color: '#fff', size: [0.63, 0.01, 0.88] },
        },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, DEFAULT_PRIVATE_FIELDS, lookup);
    expect(out).toBeNull();
  });
});

describe('isFilteredFor — ancestor walk', () => {
  test('host always sees all entities (filter returns false)', () => {
    spawn('a', 2);
    expect(isFilteredFor('a', null, true, lookup)).toBe(false);
  });

  test('recipient is owner of self → not filtered', () => {
    spawn('a', 1);
    expect(isFilteredFor('a', 1, false, lookup)).toBe(false);
  });

  test('recipient is owner of ancestor → not filtered', () => {
    const parent = spawn('p', 1);
    const child  = spawn('c', null);
    child.parentId = parent.id;
    expect(isFilteredFor('c', 1, false, lookup)).toBe(false);
  });

  test('recipient is owner of nothing in chain → filtered', () => {
    const parent = spawn('p', 1);
    const child  = spawn('c', null);
    child.parentId = parent.id;
    expect(isFilteredFor('c', 5, false, lookup)).toBe(true);
  });

  test('public chain (no privateToSeat anywhere) → not filtered', () => {
    const parent = spawn('p', null);
    const child  = spawn('c', null);
    child.parentId = parent.id;
    expect(isFilteredFor('c', 5, false, lookup)).toBe(false);
  });

  test('grandchild under private grandparent → filtered for non-owner', () => {
    const gp = spawn('gp', 1);
    const p  = spawn('p',  null);
    const c  = spawn('c',  null);
    p.parentId = gp.id;
    c.parentId = p.id;
    expect(isFilteredFor('c', 5, false, lookup)).toBe(true);
    expect(isFilteredFor('c', 1, false, lookup)).toBe(false);
  });

  test('unknown entity (not in scene) → not filtered (no ancestor data to walk)', () => {
    expect(isFilteredFor('does-not-exist', 5, false, lookup)).toBe(false);
  });
});

describe('scrubSceneMessage — ancestor-private fan-out', () => {
  test('component-patches for a child of a private parent are dropped for non-owner', () => {
    const parent = spawn('p', 1);
    const child  = spawn('c', null);
    child.parentId = parent.id;
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'c', typeId: 'surface', partial: { elements: [] } }],
    };
    expect(scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup)).toBeNull();
    expect(scrubSceneMessage({ peerSeat: 1, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup)).toEqual(msg);
  });

  test('component-patches: only filtered entities drop, others survive in the same envelope', () => {
    spawn('priv', 1);
    spawn('pub',  null);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [
        { entityId: 'priv', typeId: 'card',  partial: { face: 'A♣' } },
        { entityId: 'pub',  typeId: 'value', partial: { value: '6' } },
      ],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup);
    expect(out).not.toBeNull();
    expect((out as { patches: unknown[] }).patches).toHaveLength(1);
    expect((out as typeof msg).patches[0].entityId).toBe('pub');
  });

  test('entity-spawn for an entity nested under a private parent is dropped', () => {
    const parent = spawn('p', 1);
    spawn('c', null).parentId = parent.id;
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'c', type: 'sticker-surface', name: 'surf', tags: [],
        owner: null, privateToSeat: null, parentId: 'p', children: [],
        components: { surface: { canvasSize: [10, 10], elements: [] } },
      },
    };
    expect(scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup)).toBeNull();
  });

  test('entity-patch for a private entity is dropped for non-owner', () => {
    spawn('priv', 1);
    const msg: SceneMessage = {
      type: 'entity-patch', entityId: 'priv', partial: { name: 'renamed' },
    };
    expect(scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup)).toBeNull();
    expect(scrubSceneMessage({ peerSeat: 1, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY, lookup)).toEqual(msg);
  });
});
