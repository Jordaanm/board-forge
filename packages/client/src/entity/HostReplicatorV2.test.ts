import { describe, test, expect, beforeEach } from 'vitest';
import { HostReplicatorV2 } from './HostReplicatorV2';
import { type ComponentPatchesMessage, type EntityPatch, type SceneMessage } from './wire';

let r: HostReplicatorV2;
beforeEach(() => { r = new HostReplicatorV2(); });

describe('HostReplicatorV2 channel separation', () => {
  test('component patches route to their declared channel', () => {
    r.enqueueComponentPatch({ entityId: 'a', typeId: 'transform', partial: { x: 1 } }, 'unreliable');
    r.enqueueComponentPatch({ entityId: 'b', typeId: 'value',     partial: { v: 5 } }, 'reliable');

    const u = r.flushUnreliable();
    const reliable = r.flushReliable();

    expect(u).toHaveLength(1);
    expect((u[0] as ComponentPatchesMessage).channel).toBe('unreliable');
    expect((u[0] as ComponentPatchesMessage).patches).toEqual([
      { entityId: 'a', typeId: 'transform', partial: { x: 1 } },
    ]);

    expect(reliable).toHaveLength(1);
    expect((reliable[0] as ComponentPatchesMessage).channel).toBe('reliable');
    expect((reliable[0] as ComponentPatchesMessage).patches).toEqual([
      { entityId: 'b', typeId: 'value', partial: { v: 5 } },
    ]);
  });

  test('entity-patch / despawn / invoke / hold-* always go to reliable', () => {
    r.enqueueEntityPatch('e', { name: 'X' });
    r.enqueueDespawn(['c1', 'p']);
    r.enqueueInvokeAction({ entityId: 'e', componentTypeId: 'die', actionId: 'roll' });
    r.enqueueHoldClaim({ entityId: 'e', seat: 2 });
    r.enqueueHoldRelease({ entityId: 'e' });

    expect(r.flushUnreliable()).toEqual([]);
    const reliable = r.flushReliable();
    expect(reliable.map(m => m.type)).toEqual([
      'entity-patch', 'despawn-batch', 'invoke-action', 'hold-claim', 'hold-release',
    ]);
  });
});

describe('HostReplicatorV2 per-tick buffer + flush', () => {
  test('buffers within a tick, flush returns + clears', () => {
    r.enqueueComponentPatch({ entityId: 'a', typeId: 't', partial: { x: 1 } }, 'unreliable');
    r.enqueueComponentPatch({ entityId: 'a', typeId: 't', partial: { x: 2 } }, 'unreliable');
    r.enqueueComponentPatch({ entityId: 'b', typeId: 't', partial: { y: 9 } }, 'unreliable');

    expect(r.hasPendingUnreliable()).toBe(true);
    const out = r.flushUnreliable();
    expect((out[0] as ComponentPatchesMessage).patches).toHaveLength(3);
    expect(r.hasPendingUnreliable()).toBe(false);
    expect(r.flushUnreliable()).toEqual([]);  // second flush is empty
  });

  test('reliable component patches bundle into a single envelope', () => {
    r.enqueueComponentPatch({ entityId: 'a', typeId: 'value', partial: { v: 1 } }, 'reliable');
    r.enqueueComponentPatch({ entityId: 'b', typeId: 'value', partial: { v: 2 } }, 'reliable');
    r.enqueueEntityPatch('a', { tags: ['x'] });

    const out = r.flushReliable();
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('component-patches');
    expect((out[0] as ComponentPatchesMessage).patches).toHaveLength(2);
    expect(out[1].type).toBe('entity-patch');
  });

  test('flush of an empty buffer returns empty array', () => {
    expect(r.flushReliable()).toEqual([]);
    expect(r.flushUnreliable()).toEqual([]);
  });
});

describe('HostReplicatorV2 reparenting atomicity', () => {
  test('emits child parentId + parent children patches contiguously in one flush', () => {
    r.enqueueReparent('child', 'newParent', ['child', 'sibling']);
    const out = r.flushReliable();

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual<EntityPatch>({
      type:     'entity-patch',
      entityId: 'child',
      partial:  { parentId: 'newParent' },
    });
    expect(out[1]).toEqual<EntityPatch>({
      type:     'entity-patch',
      entityId: 'newParent',
      partial:  { children: ['child', 'sibling'] },
    });
  });

  test('detaching to root emits only the child patch', () => {
    r.enqueueReparent('child', null, null);
    const out = r.flushReliable();

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual<EntityPatch>({
      type:     'entity-patch',
      entityId: 'child',
      partial:  { parentId: null },
    });
  });

  test('reparent + intervening patches still flush atomically as a group', () => {
    r.enqueueComponentPatch({ entityId: 'x', typeId: 'transform', partial: {} }, 'reliable');
    r.enqueueReparent('child', 'newParent', ['child']);
    const out = r.flushReliable();

    // component-patches envelope first, then reparent group together.
    expect(out.map(m => m.type)).toEqual(['component-patches', 'entity-patch', 'entity-patch']);
    expect((out[1] as EntityPatch).entityId).toBe('child');
    expect((out[2] as EntityPatch).entityId).toBe('newParent');
  });
});

describe('HostReplicatorV2 v2 path off by default', () => {
  test('replicator is inert until something enqueues', () => {
    // Constructing the replicator alone produces no messages.
    expect(r.hasPendingReliable()).toBe(false);
    expect(r.hasPendingUnreliable()).toBe(false);
    const out: SceneMessage[] = [...r.flushReliable(), ...r.flushUnreliable()];
    expect(out).toEqual([]);
  });
});
