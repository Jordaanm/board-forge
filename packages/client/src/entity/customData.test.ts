import { describe, test, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { Entity } from './Entity';
import { entityToSerialized } from './Scene';
import { type ComponentReplicator } from './EntityComponent';
import { type EntityFieldsPartial } from './wire';
import { createWorld } from './world/World';
import { createInMemoryBusPair } from './world/InMemoryTransport';
import { type World } from './world/types';
import { type SeatIndex } from '../seats/SeatLayout';

class StubReplicator implements ComponentReplicator {
  patches: Array<{ entityId: string; partial: EntityFieldsPartial }> = [];
  enqueueComponentPatch(): void { /* unused */ }
  enqueueEntityPatch(entityId: string, partial: EntityFieldsPartial): void {
    this.patches.push({ entityId, partial });
  }
}

function attachToReplicator(e: Entity, repl: ComponentReplicator): void {
  // Mirror SceneImpl.add minimally: hand the entity a scene-shaped object
  // whose `world` reference is the replicator under test.
  e.scene = { world: repl } as unknown as Entity['scene'];
}

describe('Entity.customData', () => {
  test('initialises empty', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    expect(e.customData.size).toBe(0);
  });

  test('init carries customData when supplied', () => {
    const e = new Entity({
      id: 'a', type: 'x', name: 'x',
      customData: { score: '0', tier: 'gold' },
    });
    expect(e.customData.get('score')).toBe('0');
    expect(e.customData.get('tier')).toBe('gold');
  });

  test('setCustomData / getCustomData round-trip', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    e.setCustomData('score', '0');
    expect(e.getCustomData('score')).toBe('0');
    e.setCustomData('score', '1');
    expect(e.getCustomData('score')).toBe('1');
  });

  test('deleteCustomData clears the key', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    e.setCustomData('score', '0');
    expect(e.deleteCustomData('score')).toBe(true);
    expect(e.getCustomData('score')).toBeUndefined();
  });

  test('deleteCustomData returns false for missing keys', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    expect(e.deleteCustomData('never')).toBe(false);
  });

  test('mutation enqueues a full-map entity-patch when attached to a host scene', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    const repl = new StubReplicator();
    attachToReplicator(e, repl);

    e.setCustomData('score', '0');
    e.setCustomData('tier', 'gold');
    e.deleteCustomData('score');

    expect(repl.patches).toHaveLength(3);
    expect(repl.patches[0]).toEqual({ entityId: 'a', partial: { customData: { score: '0' } } });
    expect(repl.patches[1]).toEqual({ entityId: 'a', partial: { customData: { score: '0', tier: 'gold' } } });
    expect(repl.patches[2]).toEqual({ entityId: 'a', partial: { customData: { tier: 'gold' } } });
  });

  test('mutation does NOT enqueue when no host scene is attached (e.g. on guests)', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    expect(() => e.setCustomData('score', '0')).not.toThrow();
    expect(e.getCustomData('score')).toBe('0');
  });
});

describe('entityToSerialized — customData round-trip', () => {
  test('writes customData as a plain object when populated', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    e.setCustomData('score', '0');
    e.setCustomData('tier', 'gold');
    const snap = entityToSerialized(e);
    expect(snap.customData).toEqual({ score: '0', tier: 'gold' });
  });

  test('omits customData when the map is empty', () => {
    const e = new Entity({ id: 'a', type: 'x', name: 'x' });
    const snap = entityToSerialized(e);
    expect(snap.customData).toBeUndefined();
  });

  test('save → load round-trip preserves keys and values exactly', async () => {
    const { SceneImpl } = await import('./Scene');
    const e = new Entity({ id: 'a', type: 'die', name: 'Die-a' });
    e.setCustomData('score', '0');
    e.setCustomData('tier', 'gold');
    const snap = entityToSerialized(e);

    const scene = new SceneImpl();
    const ctx = {
      scene:       null as unknown as import('three').Scene,
      physics:     null,
      entityScene: scene,
    };
    // Pass through SceneImpl.load. The die spawnable is registered in the
    // production registry, but we only care about the customData carrier
    // here — bypass component registration by using an empty components map.
    const minimal = { ...snap, components: {} as Record<string, object> };
    scene.load([minimal], ctx);

    const loaded = scene.getEntity('a')!;
    expect(loaded.customData.get('score')).toBe('0');
    expect(loaded.customData.get('tier')).toBe('gold');
  });

  test('loading a pre-scripting save (no customData field) yields an empty map', async () => {
    const { SceneImpl } = await import('./Scene');
    const scene = new SceneImpl();
    const ctx = {
      scene:       null as unknown as import('three').Scene,
      physics:     null,
      entityScene: scene,
    };
    scene.load([{
      id: 'a', type: 'die', name: 'Die-a',
      tags: [], owner: null, privateToSeat: null,
      parentId: null, children: [],
      components: {},
    }], ctx);
    expect(scene.getEntity('a')!.customData.size).toBe(0);
  });
});

// Boundary test: host mutate → wire → guest apply via the real World pair.
const HOST_PEER_ID  = 'host-peer';
const GUEST_PEER_ID = 'guest-peer';
const HOST_SEAT:  SeatIndex = 0;
const GUEST_SEAT: SeatIndex = 1;

interface Pair { host: World; guest: World }

function setupPair(): Pair {
  const bus = createInMemoryBusPair();
  const peerSeats = new Map<string, SeatIndex>([[GUEST_PEER_ID, GUEST_SEAT]]);
  const host = createWorld({
    role:        'host',
    scene:       new THREE.Scene(),
    identity:    { isHost: true,  selfSeat: () => HOST_SEAT,  selfPeerId: () => HOST_PEER_ID },
    transport:   bus.host,
    getPeerSeat: (peerId) => peerSeats.get(peerId) ?? null,
  });
  const guest = createWorld({
    role:      'guest',
    scene:     new THREE.Scene(),
    identity:  { isHost: false, selfSeat: () => GUEST_SEAT, selfPeerId: () => GUEST_PEER_ID },
    transport: bus.guest,
  });
  return { host, guest };
}

describe('customData — host→guest replication', () => {
  let pair: Pair | null = null;
  afterEach(() => {
    pair?.host.dispose();
    pair?.guest.dispose();
    pair = null;
  });

  test('host mutation propagates the new customData map to the guest', () => {
    pair = setupPair();
    const handle = pair.host.spawn('die', { id: 'die-data' });
    pair.host.tick(0.016);  // replicate the spawn

    handle.entity.setCustomData('score', '0');
    handle.entity.setCustomData('tier', 'gold');
    pair.host.tick(0.016);

    const guestEntity = pair.guest.get('die-data')!.entity;
    expect(guestEntity.customData.get('score')).toBe('0');
    expect(guestEntity.customData.get('tier')).toBe('gold');
  });

  test('host deletion propagates as a full-map overwrite', () => {
    pair = setupPair();
    const handle = pair.host.spawn('die', { id: 'die-data' });
    pair.host.tick(0.016);

    handle.entity.setCustomData('score', '0');
    handle.entity.setCustomData('tier', 'gold');
    pair.host.tick(0.016);

    handle.entity.deleteCustomData('score');
    pair.host.tick(0.016);

    const guestEntity = pair.guest.get('die-data')!.entity;
    expect(guestEntity.customData.get('score')).toBeUndefined();
    expect(guestEntity.customData.get('tier')).toBe('gold');
  });
});
