// Dual-fire RPC integration test — issue #4 of issues--interaction.md.
//
// Verifies that `World.fireInputEvent` on a guest fires locally first then
// emits a `guest-input-event` to the host, and that the host's inbound
// router validates seat + entity before re-firing on its bus.

import { describe, test, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createWorld } from './World';
import { createInMemoryBusPair } from './InMemoryTransport';
import { type World } from './types';
import { type SeatIndex } from '../../seats/SeatLayout';
import { type InputEventPayload } from '../../input/inputEvents';
import { TABLE_ENTITY_ID } from '../tableEntity';

const HOST_PEER_ID  = 'host-peer';
const GUEST_PEER_ID = 'guest-peer';
const HOST_SEAT:  SeatIndex = 0;
const GUEST_SEAT: SeatIndex = 1;

interface Pair {
  host:  World;
  guest: World;
}

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
  return { host, guest };
}

function payloadFor(seat: SeatIndex | null): InputEventPayload {
  return { seat, shiftKey: false, ctrlKey: false, altKey: false, worldHit: { x: 1, y: 2, z: 3 } };
}

describe('World.fireInputEvent — dual-fire RPC', () => {
  let pair: Pair | null = null;

  afterEach(() => {
    pair?.host.dispose();
    pair?.guest.dispose();
    pair = null;
  });

  test('guest fires locally first, then host re-fires on its bus', () => {
    pair = setup();
    pair.host.tick(0.016);  // replicate Table to guest

    const localCalls: InputEventPayload[] = [];
    const hostCalls:  InputEventPayload[] = [];
    pair.guest.get(TABLE_ENTITY_ID)!.entity.addEventListener(
      'click',
      (p) => localCalls.push(p as InputEventPayload),
    );
    pair.host.get(TABLE_ENTITY_ID)!.entity.addEventListener(
      'click',
      (p) => hostCalls.push(p as InputEventPayload),
    );

    const payload = payloadFor(GUEST_SEAT);
    pair.guest.fireInputEvent(pair.guest.get(TABLE_ENTITY_ID)!.entity, 'click', payload);

    expect(localCalls).toEqual([payload]);
    expect(hostCalls).toEqual([payload]);
  });

  test('host fireInputEvent is local-only — no RPC echoed back to guests', () => {
    pair = setup();
    pair.host.tick(0.016);

    const hostCalls:  InputEventPayload[] = [];
    const guestCalls: InputEventPayload[] = [];
    pair.host.get(TABLE_ENTITY_ID)!.entity.addEventListener(
      'click',
      (p) => hostCalls.push(p as InputEventPayload),
    );
    pair.guest.get(TABLE_ENTITY_ID)!.entity.addEventListener(
      'click',
      (p) => guestCalls.push(p as InputEventPayload),
    );

    const payload = payloadFor(HOST_SEAT);
    pair.host.fireInputEvent(pair.host.get(TABLE_ENTITY_ID)!.entity, 'click', payload);

    expect(hostCalls).toEqual([payload]);
    expect(guestCalls).toEqual([]);
  });

  test('host rejects when sender seat does not match payload.seat', () => {
    pair = setup();
    pair.host.tick(0.016);

    const hostCalls: InputEventPayload[] = [];
    pair.host.get(TABLE_ENTITY_ID)!.entity.addEventListener(
      'click',
      (p) => hostCalls.push(p as InputEventPayload),
    );

    // Guest claims it's seat 99 in the payload — host knows the sender is
    // actually GUEST_SEAT (1) and silently drops.
    const payload: InputEventPayload = {
      seat: 99 as SeatIndex,
      shiftKey: false, ctrlKey: false, altKey: false,
    };
    pair.guest.fireInputEvent(pair.guest.get(TABLE_ENTITY_ID)!.entity, 'click', payload);

    expect(hostCalls).toEqual([]);
  });

  test('host rejects on unknown entityId (guest spawn race)', () => {
    pair = setup();
    pair.host.tick(0.016);

    // Build a phantom entity client-side and try to fire on it. The host's
    // scene doesn't know about it — `getEntity` returns undefined and the
    // event is silently dropped.
    const phantom = pair.guest.get(TABLE_ENTITY_ID)!.entity;
    Object.defineProperty(phantom, 'id', { value: 'unknown-id' });
    const hostCalls: unknown[] = [];
    pair.host.get(TABLE_ENTITY_ID)!.entity.addEventListener('click', (p) => hostCalls.push(p));

    pair.guest.fireInputEvent(phantom, 'click', payloadFor(GUEST_SEAT));
    expect(hostCalls).toEqual([]);
  });

  test('all five event types route through fireInputEvent dual-fire', () => {
    pair = setup();
    pair.host.tick(0.016);

    const seen: string[] = [];
    for (const name of ['pressed', 'released', 'click', 'hover-start', 'hover-end']) {
      pair.host.get(TABLE_ENTITY_ID)!.entity.addEventListener(name, () => seen.push(name));
    }
    const guestEntity = pair.guest.get(TABLE_ENTITY_ID)!.entity;
    const payload    = payloadFor(GUEST_SEAT);
    pair.guest.fireInputEvent(guestEntity, 'pressed',     payload);
    pair.guest.fireInputEvent(guestEntity, 'released',    payload);
    pair.guest.fireInputEvent(guestEntity, 'click',       payload);
    pair.guest.fireInputEvent(guestEntity, 'hover-start', payload);
    pair.guest.fireInputEvent(guestEntity, 'hover-end',   payload);

    expect(seen).toEqual(['pressed', 'released', 'click', 'hover-start', 'hover-end']);
  });
});
