// Boundary test: host→guest round-trip via InMemoryTransport. Issue #1 of
// issues--arch.md — first integration test that exercises spawn, replicator
// flush, transport hop, and inbound dispatch as one chain.

import { describe, test, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from './World';
import { createInMemoryBusPair } from './InMemoryTransport';
import { TransformComponent } from '../components/TransformComponent';
import { ValueComponent } from '../components/ValueComponent';
import { Scene } from '../Scene';
import { type World } from './types';

interface Pair {
  host:  World;
  guest: World;
}

function setup(): Pair {
  const [hostTransport, guestTransport] = createInMemoryBusPair();
  const host = createWorld({
    role:      'host',
    scene:     new THREE.Scene(),
    identity:  { isHost: true,  selfSeat: () => 0, selfPeerId: () => 'host' },
    transport: hostTransport,
  });
  const guest = createWorld({
    role:      'guest',
    scene:     new THREE.Scene(),
    identity:  { isHost: false, selfSeat: () => 1, selfPeerId: () => 'guest' },
    transport: guestTransport,
  });
  return { host, guest };
}

describe('World — host→guest round-trip', () => {
  let pair: Pair | null = null;

  afterEach(() => {
    pair?.host.dispose();
    pair?.guest.dispose();
    pair = null;
    Scene.clear();  // singleton hygiene — issue #5 deletes the singleton entirely.
  });

  test('guest receives entity-spawn after host.tick flushes the replicator', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1', position: [1, 5, 2] });
    pair.host.tick(0.016);

    const guestHandle = pair.guest.get('die-1');
    expect(guestHandle).toBeDefined();
    expect(guestHandle!.entity.type).toBe('die');
    expect(guestHandle!.entity.id).toBe('die-1');

    const t = guestHandle!.get(TransformComponent)!;
    expect(t.state.position[0]).toBeCloseTo(1, 5);
    expect(t.state.position[2]).toBeCloseTo(2, 5);
  });

  test('component state survives the round-trip', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1' });
    pair.host.tick(0.016);

    const guestHandle = pair.guest.get('die-1');
    const value       = guestHandle!.get(ValueComponent)!;
    expect(value.state.value).toBe('6');
    expect(value.state.isNumeric).toBe(true);
  });

  test('guest.all() reflects host spawns after tick', () => {
    pair = setup();
    pair.host.spawn('die',  { id: 'a' });
    pair.host.spawn('token', { id: 'b' });
    pair.host.tick(0.016);

    const ids = pair.guest.all().map(h => h.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  test('host despawn propagates to guest', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1' });
    pair.host.tick(0.016);
    expect(pair.guest.get('die-1')).toBeDefined();

    pair.host.despawn('die-1');
    pair.host.tick(0.016);
    expect(pair.guest.get('die-1')).toBeUndefined();
  });

  test('guest.tick is a no-op (no replication, no physics)', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1' });
    pair.host.tick(0.016);

    const before = pair.guest.get('die-1')!.entity;
    pair.guest.tick(0.016);
    const after = pair.guest.get('die-1')!.entity;
    expect(after).toBe(before);
  });

  test('subscribers fire on inbound state changes', () => {
    pair = setup();
    let calls = 0;
    pair.guest.subscribe(() => { calls++; });

    pair.host.spawn('die', { id: 'die-1' });
    pair.host.tick(0.016);

    expect(calls).toBeGreaterThan(0);
  });
});
