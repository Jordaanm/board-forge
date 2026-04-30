import { describe, test, expect, beforeEach } from 'vitest';
import { Scene } from '../entity/Scene';
import { Entity } from '../entity/Entity';
import { ComponentRegistry } from '../entity/ComponentRegistry';
import {
  EMPTY_PRIVATE_FIELD_REGISTRY,
  scrubSceneMessage,
  type PrivateFieldRegistry,
} from './PrivacyScrubber';
import { type SceneMessage } from '../entity/wire';
import { type SeatIndex } from './SeatLayout';

beforeEach(() => {
  Scene.clear();
  Scene.setRegistry(new ComponentRegistry());
});

function spawn(id: string, privateToSeat: SeatIndex | null = null): Entity {
  const e = new Entity({ id, type: 'thing', name: id, privateToSeat });
  Scene.add(e);
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
      { peerSeat: 5, isHost: false }, msg, EMPTY_PRIVATE_FIELD_REGISTRY,
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
    const out = scrubSceneMessage({ peerSeat: 5, isHost: true }, msg, registry);
    expect(out).toEqual(msg);
  });

  test('owner seat sees full state', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 2, isHost: false }, msg, registry);
    expect(out).toEqual(msg);
  });

  test('non-owner seat receives redacted fields', () => {
    spawn('a', 2);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry);
    expect((out as typeof msg).patches[0].partial).toEqual({ back: 'red' });
  });

  test('public entity (privateToSeat = null) is not redacted', () => {
    spawn('a', null);
    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'a', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry);
    expect(out).toEqual(msg);
  });
});

describe('scrubSceneMessage entity-spawn with private fields', () => {
  const registry: PrivateFieldRegistry = { card: ['face'] };

  test('non-owner receives redacted components', () => {
    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'a', type: 'card', name: 'A', tags: [],
        owner: 1, privateToSeat: 1, parentId: null, children: [],
        components: { card: { face: 'A♣', back: 'red' } },
      },
    };
    const out = scrubSceneMessage({ peerSeat: 5, isHost: false }, msg, registry);
    expect((out as typeof msg).entity.components.card).toEqual({ back: 'red' });
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
    const out = scrubSceneMessage({ peerSeat: 1, isHost: false }, msg, registry);
    expect(out).toEqual(msg);
  });
});
