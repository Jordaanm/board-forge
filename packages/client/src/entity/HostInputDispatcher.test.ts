import { describe, test, expect, beforeEach } from 'vitest';
import { Scene } from './Scene';
import { Entity } from './Entity';
import { ComponentRegistry } from './ComponentRegistry';
import { EntityComponent } from './EntityComponent';
import { HostReplicatorV2 } from './HostReplicatorV2';
import { HoldService } from './HoldService';
import { HostInputDispatcher } from './HostInputDispatcher';
import { type SeatIndex } from '../seats/SeatLayout';

interface ValueState { v: number }
class ValueComp extends EntityComponent<ValueState> {
  static typeId = 'value';
  applied: Partial<ValueState>[] = [];
  onSpawn() {}
  onPropertiesChanged(p: Partial<ValueState>) { this.applied.push(p); }
}

let r: HostReplicatorV2;
let svc: HoldService;
let dispatcher: HostInputDispatcher;
const PEERS = new Map<string, SeatIndex | null>();

function spawn(id: string, owner: SeatIndex | null = null): Entity {
  const e = new Entity({ id, type: 'thing', name: id, owner });
  const v = new ValueComp();
  v.state = { v: 0 };
  e.attachComponent(v);
  Scene.add(e);
  return e;
}

beforeEach(() => {
  Scene.clear();
  Scene.setRegistry(new ComponentRegistry());
  PEERS.clear();
  r = new HostReplicatorV2();
  svc = new HoldService(r);
  dispatcher = new HostInputDispatcher(svc, (peerId) => PEERS.get(peerId) ?? null);
  EntityComponent.setHostReplicator(r);
});

describe('HostInputDispatcher.handleHoldClaim — OwnershipPolicy gating', () => {
  test('owner-seated guest is accepted', () => {
    const e = spawn('a', 1);
    PEERS.set('p1', 1);
    expect(dispatcher.handleHoldClaim('p1', { type: 'hold-claim', entityId: 'a', seat: 1 })).toBe(true);
    expect(e.heldBy).toBe(1);
  });

  test('non-owner seated guest is refused', () => {
    const e = spawn('a', 1);
    PEERS.set('p2', 2);
    expect(dispatcher.handleHoldClaim('p2', { type: 'hold-claim', entityId: 'a', seat: 2 })).toBe(false);
    expect(e.heldBy).toBeNull();
  });

  test('spectator (peerSeat null) is refused', () => {
    const e = spawn('a', null);
    PEERS.set('p3', null);
    expect(dispatcher.handleHoldClaim('p3', { type: 'hold-claim', entityId: 'a', seat: null as unknown as SeatIndex })).toBe(false);
    expect(e.heldBy).toBeNull();
  });

  test('any seated guest may claim an unowned entity', () => {
    const e = spawn('a', null);
    PEERS.set('p4', 3);
    expect(dispatcher.handleHoldClaim('p4', { type: 'hold-claim', entityId: 'a', seat: 3 })).toBe(true);
    expect(e.heldBy).toBe(3);
  });

  test('claim refused if already held', () => {
    const e = spawn('a', null);
    e.heldBy = 1;
    PEERS.set('p2', 2);
    expect(dispatcher.handleHoldClaim('p2', { type: 'hold-claim', entityId: 'a', seat: 2 })).toBe(false);
    expect(e.heldBy).toBe(1);
  });

  test('unknown entity → refused', () => {
    expect(dispatcher.handleHoldClaim('px', { type: 'hold-claim', entityId: 'missing', seat: 1 })).toBe(false);
  });
});

describe('HostInputDispatcher.handleRequestUpdate — OwnershipPolicy gating', () => {
  test('owner-seated guest update is applied', () => {
    const e = spawn('a', 1);
    PEERS.set('p1', 1);
    expect(dispatcher.handleRequestUpdate('p1', {
      type: 'request-update', entityId: 'a', typeId: 'value', partial: { v: 7 },
    })).toBe(true);
    expect((e.components.get('value') as ValueComp).state.v).toBe(7);
  });

  test('non-owner seated guest update is refused', () => {
    const e = spawn('a', 1);
    PEERS.set('p2', 2);
    expect(dispatcher.handleRequestUpdate('p2', {
      type: 'request-update', entityId: 'a', typeId: 'value', partial: { v: 9 },
    })).toBe(false);
    expect((e.components.get('value') as ValueComp).state.v).toBe(0);
  });

  test('spectator update is refused', () => {
    const e = spawn('a', null);
    PEERS.set('p3', null);
    expect(dispatcher.handleRequestUpdate('p3', {
      type: 'request-update', entityId: 'a', typeId: 'value', partial: { v: 5 },
    })).toBe(false);
    expect((e.components.get('value') as ValueComp).state.v).toBe(0);
  });

  test('unknown component typeId → refused', () => {
    spawn('a', 1);
    PEERS.set('p1', 1);
    expect(dispatcher.handleRequestUpdate('p1', {
      type: 'request-update', entityId: 'a', typeId: 'nope', partial: {},
    })).toBe(false);
  });
});

describe('HostInputDispatcher.handleHoldRelease', () => {
  test('release succeeds when sender holds the entity', () => {
    const e = spawn('a', null);
    PEERS.set('p1', 1);
    svc.tryClaim(e, 1);
    r.flushReliable();

    expect(dispatcher.handleHoldRelease('p1', {
      type: 'hold-release', entityId: 'a', vx: 1, vy: 0, vz: 2,
    })).toBe(true);
    expect(e.heldBy).toBeNull();
  });

  test('release refused when sender is not the holder', () => {
    const e = spawn('a', null);
    PEERS.set('p1', 1);
    PEERS.set('p2', 2);
    svc.tryClaim(e, 1);
    r.flushReliable();

    expect(dispatcher.handleHoldRelease('p2', { type: 'hold-release', entityId: 'a' })).toBe(false);
    expect(e.heldBy).toBe(1);
  });
});
