// Boundary test: per-peer privacy scrubbing inside RtcTransport.
// Issue #7 of issues--arch.md.

import { describe, test, expect } from 'vitest';
import { Entity } from '../Entity';
import { RtcTransport } from './RtcTransport';
import { type ChannelMessage } from '../../net/SceneState';
import { type SceneMessage } from '../wire';
import { type ReplicationTarget } from './types';
import { type PrivateFieldRegistry } from '../../seats/PrivacyScrubber';
import { type SeatIndex } from '../../seats/SeatLayout';

interface SentTo {
  peerId: string;
  msg:    ChannelMessage;
}

function makeTransport(
  targets:  ReplicationTarget[],
  entities: Map<string, Entity>,
  registry: PrivateFieldRegistry,
): { transport: RtcTransport; sent: SentTo[]; broadcasts: ChannelMessage[] } {
  const sent: SentTo[]            = [];
  const broadcasts: ChannelMessage[] = [];
  const transport = new RtcTransport({
    send:       (msg) => broadcasts.push(msg),
    sendTo:     (peerId, msg) => sent.push({ peerId, msg }),
    getTargets: () => targets,
    getEntity:  (id) => entities.get(id),
    privateFieldRegistry: registry,
  });
  return { transport, sent, broadcasts };
}

function privateEntity(id: string, seat: SeatIndex): Entity {
  return new Entity({ id, type: 'card', name: id, privateToSeat: seat });
}

describe('RtcTransport — privacy scrubbing fan-out', () => {
  test('component-patches: claimant gets full state, non-claimant gets nothing (full-entity filter)', () => {
    const claimantSeat: SeatIndex = 1;
    const targets: ReplicationTarget[] = [
      { peerId: 'p-claimant', peerSeat: claimantSeat, isHost: false },
      { peerId: 'p-other',    peerSeat: 4,            isHost: false },
    ];
    const entities = new Map<string, Entity>([['card-1', privateEntity('card-1', claimantSeat)]]);
    const registry: PrivateFieldRegistry = { card: ['face'] };
    const { transport, sent } = makeTransport(targets, entities, registry);

    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'card-1', typeId: 'card', partial: { face: 'A♣', back: 'red' } }],
    };
    transport.send(msg, { reliable: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].peerId).toBe('p-claimant');
    expect((sent[0].msg as typeof msg).patches[0].partial).toEqual({ face: 'A♣', back: 'red' });
  });

  test('entity-spawn: claimant receives full spawn, non-claimant receives nothing', () => {
    const claimantSeat: SeatIndex = 2;
    const targets: ReplicationTarget[] = [
      { peerId: 'p-claimant', peerSeat: claimantSeat, isHost: false },
      { peerId: 'p-other',    peerSeat: 5,            isHost: false },
    ];
    const registry: PrivateFieldRegistry = { card: ['face'] };
    const entities = new Map<string, Entity>([['card-1', privateEntity('card-1', claimantSeat)]]);
    const { transport, sent } = makeTransport(targets, entities, registry);

    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'card-1', type: 'card', name: 'A', tags: [],
        owner: claimantSeat, privateToSeat: claimantSeat, parentId: null, children: [],
        components: { card: { face: 'A♣', back: 'red' } },
      },
    };
    transport.send(msg, { reliable: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].peerId).toBe('p-claimant');
    expect((sent[0].msg as typeof msg).entity.components.card).toEqual({ face: 'A♣', back: 'red' });
  });

  test('component-patches: ancestor-private parent → child patches dropped for non-owner', () => {
    const parent = privateEntity('parent', 1);
    const child  = new Entity({ id: 'child', type: 'sticker-surface', name: 'surf' });
    child.parentId = 'parent';
    const targets: ReplicationTarget[] = [
      { peerId: 'p-owner', peerSeat: 1, isHost: false },
      { peerId: 'p-other', peerSeat: 5, isHost: false },
    ];
    const entities = new Map<string, Entity>([['parent', parent], ['child', child]]);
    const { transport, sent } = makeTransport(targets, entities, {});

    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'child', typeId: 'surface', partial: { elements: [] } }],
    };
    transport.send(msg, { reliable: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].peerId).toBe('p-owner');
  });

  test('entity-spawn: child of a private parent is filtered entirely on non-owner fan-out', () => {
    const parent = privateEntity('parent', 1);
    const child  = new Entity({ id: 'child', type: 'sticker-surface', name: 'surf' });
    child.parentId = 'parent';
    const targets: ReplicationTarget[] = [
      { peerId: 'p-owner', peerSeat: 1, isHost: false },
      { peerId: 'p-other', peerSeat: 5, isHost: false },
    ];
    const entities = new Map<string, Entity>([['parent', parent], ['child', child]]);
    const { transport, sent } = makeTransport(targets, entities, {});

    const msg: SceneMessage = {
      type: 'entity-spawn',
      entity: {
        id: 'child', type: 'sticker-surface', name: 'surf', tags: [],
        owner: null, privateToSeat: null, parentId: 'parent', children: [],
        components: { surface: { canvasSize: [10, 10], elements: [] } },
      },
    };
    transport.send(msg, { reliable: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].peerId).toBe('p-owner');
  });

  test('public entity (privateToSeat null) goes to every peer unchanged', () => {
    const targets: ReplicationTarget[] = [
      { peerId: 'p-a', peerSeat: 0, isHost: false },
      { peerId: 'p-b', peerSeat: 1, isHost: false },
    ];
    const entities = new Map<string, Entity>([
      ['card-1', new Entity({ id: 'card-1', type: 'card', name: 'pub', privateToSeat: null })],
    ]);
    const registry: PrivateFieldRegistry = { card: ['face'] };
    const { transport, sent } = makeTransport(targets, entities, registry);

    const msg: SceneMessage = {
      type: 'component-patches', channel: 'reliable',
      patches: [{ entityId: 'card-1', typeId: 'card', partial: { face: 'X', back: 'Y' } }],
    };
    transport.send(msg, { reliable: true });

    for (const s of sent) {
      expect((s.msg as typeof msg).patches[0].partial).toEqual({ face: 'X', back: 'Y' });
    }
  });

  test('guest path (no targets): broadcast bypass — no scrubbing, no fan-out', () => {
    const { transport, sent, broadcasts } = makeTransport([], new Map(), { card: ['face'] });
    const msg: SceneMessage = { type: 'hold-claim', entityId: 'card-1', seat: 1 };

    transport.send(msg, { reliable: true });

    expect(sent).toEqual([]);
    expect(broadcasts).toEqual([msg]);
  });

  test('GuestInputMessage broadcasts as-is even when targets exist', () => {
    const targets: ReplicationTarget[] = [
      { peerId: 'p-a', peerSeat: 0, isHost: false },
    ];
    const { transport, sent, broadcasts } = makeTransport(targets, new Map(), { card: ['face'] });

    transport.send(
      { type: 'guest-drag-move', objectId: 'card-1', px: 1, py: 2, pz: 3 },
      { reliable: false },
    );

    expect(sent).toEqual([]);
    expect(broadcasts).toHaveLength(1);
  });
});
