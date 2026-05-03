// Boundary tests: host→guest round-trip via InMemoryTransport.
// Issue #1: replication chain (spawn → flush → transport → inbound dispatch).
// Issue #3: guest drag chain (tryHold → setPosition → release through EntityHandle).
// Issue #8: late-join scene-snapshot via World peer-join handler.

import { describe, test, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from './World';
import { createInMemoryBusPair } from './InMemoryTransport';
import { TransformComponent } from '../components/TransformComponent';
import { ValueComponent } from '../components/ValueComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { type World } from './types';
import { type SeatIndex } from '../../seats/SeatLayout';

interface Pair {
  host:  World;
  guest: World;
  firePeerJoin: (side: 'host' | 'guest', peerId: string) => void;
}

const HOST_PEER_ID  = 'host-peer';
const GUEST_PEER_ID = 'guest-peer';
const HOST_SEAT:  SeatIndex = 0;
const GUEST_SEAT: SeatIndex = 1;

function setup(): Pair {
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
  return { host, guest, firePeerJoin: bus.firePeerJoin };
}

describe('World — host→guest round-trip', () => {
  let pair: Pair | null = null;

  afterEach(() => {
    pair?.host.dispose();
    pair?.guest.dispose();
    pair = null;
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

describe('World — guest drag round-trip (issue #3)', () => {
  let pair: Pair | null = null;

  afterEach(() => {
    pair?.host.dispose();
    pair?.guest.dispose();
    pair = null;
  });

  test('guest tryHold → host accepts → guest sees heldBy === guest seat', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1', position: [0, 5, 0] });
    pair.host.tick(0.016);

    const guestHandle = pair.guest.get('die-1')!;
    expect(guestHandle.heldBy()).toBeNull();

    const accepted = guestHandle.tryHold(GUEST_SEAT);
    // Guest's tryHold returns true on local validation; the host echo arrives
    // through the InMemoryTransport synchronously inside the same call (host
    // dispatches HostInputDispatcher.handleHoldClaim → HoldService.tryClaim
    // → enqueueHoldClaim → host.tick flushes the echo to guest). Without a
    // host.tick the echo hasn't been flushed yet.
    expect(accepted).toBe(true);
    expect(guestHandle.heldBy()).toBeNull();  // echo not yet flushed

    pair.host.tick(0.016);
    expect(guestHandle.heldBy()).toBe(GUEST_SEAT);
  });

  test('guest setPosition writes host body via guest-drag-move RPC', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1', position: [0, 5, 0] });
    pair.host.tick(0.016);

    const guestHandle = pair.guest.get('die-1')!;
    guestHandle.tryHold(GUEST_SEAT);
    pair.host.tick(0.016);  // flush hold-claim echo to guest

    const targetX = 2.5;
    const targetY = 1.0;
    const targetZ = -1.5;
    guestHandle.setPosition(targetX, targetY, targetZ);

    // GuestInputHandler on the host writes body.position synchronously.
    const hostBody = pair.host.get('die-1')!.get(PhysicsComponent)!.body;
    expect(hostBody.position.x).toBeCloseTo(targetX, 5);
    expect(hostBody.position.y).toBeCloseTo(targetY, 5);
    expect(hostBody.position.z).toBeCloseTo(targetZ, 5);

    // Guest's optimistic transform tracks the same target.
    const guestT = guestHandle.get(TransformComponent)!;
    expect(guestT.state.position[0]).toBeCloseTo(targetX, 5);
    expect(guestT.state.position[1]).toBeCloseTo(targetY, 5);
    expect(guestT.state.position[2]).toBeCloseTo(targetZ, 5);
  });

  test('guest release with velocity flips heldBy back to null + applies throw', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1', position: [0, 5, 0] });
    pair.host.tick(0.016);

    const guestHandle = pair.guest.get('die-1')!;
    guestHandle.tryHold(GUEST_SEAT);
    pair.host.tick(0.016);
    expect(guestHandle.heldBy()).toBe(GUEST_SEAT);

    guestHandle.release({ vx: 1, vy: 0, vz: 2 });
    // Host's HostInputDispatcher.handleHoldRelease ran HoldService.release
    // synchronously: entity.heldBy=null + body velocity set.
    const hostHandle = pair.host.get('die-1')!;
    expect(hostHandle.heldBy()).toBeNull();
    const hostBody = hostHandle.get(PhysicsComponent)!.body;
    expect(hostBody.velocity.x).toBeCloseTo(1, 5);
    expect(hostBody.velocity.z).toBeCloseTo(2, 5);

    // Guest needs the host echo to update its view of heldBy.
    pair.host.tick(0.016);
    expect(guestHandle.heldBy()).toBeNull();
  });

  test('full drag → carry → release: host body matches guest optimistic position', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'die-1', position: [0, 5, 0] });
    pair.host.tick(0.016);

    const guestHandle = pair.guest.get('die-1')!;
    guestHandle.tryHold(GUEST_SEAT);
    pair.host.tick(0.016);

    guestHandle.setPosition(3, 1, 4);
    pair.host.tick(0.016);  // physics step + flush component-patches to guest

    const hostBody = pair.host.get('die-1')!.get(PhysicsComponent)!.body;
    const guestPos = guestHandle.position();
    // Body is kinematic during a hold — physics step doesn't move it. Host
    // body and guest optimistic position both sit at the target.
    expect(hostBody.position.x).toBeCloseTo(guestPos.x, 5);
    expect(hostBody.position.z).toBeCloseTo(guestPos.z, 5);

    guestHandle.release();
    pair.host.tick(0.016);
    expect(guestHandle.heldBy()).toBeNull();
  });
});

describe('World — late-join scene-snapshot (issue #8)', () => {
  let pair: Pair | null = null;

  afterEach(() => {
    pair?.host.dispose();
    pair?.guest.dispose();
    pair = null;
  });

  test('host pre-populates 3 entities; guest joins; sees full scene', () => {
    pair = setup();
    // Pre-populate the host. The InMemoryTransport delivers spawns straight
    // into the existing guest as they happen, so to exercise the late-join
    // path specifically we capture the snapshot, dispose, rebuild the pair
    // with a fresh empty guest, prime the host via loadSnapshot, then fire
    // peer-join.
    pair.host.spawn('die',   { id: 'd-1' });
    pair.host.spawn('token', { id: 't-1' });
    pair.host.spawn('board', { id: 'b-1' });
    const snap = pair.host.snapshot();
    pair.host.dispose();
    pair.guest.dispose();

    pair = setup();
    pair.host.loadSnapshot(snap);
    expect(pair.guest.all()).toEqual([]);  // sanity: guest starts empty

    pair.firePeerJoin('host', GUEST_PEER_ID);

    const ids = pair.guest.all().map(h => h.id).sort();
    expect(ids).toEqual(['b-1', 'd-1', 't-1']);

    const guestDie = pair.guest.get('d-1')!;
    expect(guestDie.entity.type).toBe('die');
    expect(guestDie.get(ValueComponent)!.state.value).toBe('6');
  });

  test('snapshot is idempotent — re-firing peer-join does not throw on duplicates', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'd-1' });
    const snap = pair.host.snapshot();
    pair.host.dispose();
    pair.guest.dispose();

    pair = setup();
    pair.host.loadSnapshot(snap);

    pair.firePeerJoin('host', GUEST_PEER_ID);
    expect(() => pair!.firePeerJoin('host', GUEST_PEER_ID)).not.toThrow();
    expect(pair.guest.all().map(h => h.id)).toEqual(['d-1']);
  });

  test('guest peer-join handler is a no-op (only host replays)', () => {
    pair = setup();
    pair.host.spawn('die', { id: 'd-1' });
    pair.host.tick(0.016);

    // Firing a peer-join on the guest's side should not produce an error or
    // a stray scene-snapshot from the guest. Guest entities are still there.
    expect(() => pair!.firePeerJoin('guest', HOST_PEER_ID)).not.toThrow();
    expect(pair.guest.get('d-1')).toBeDefined();
  });
});
