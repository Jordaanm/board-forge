import { describe, test, expect } from 'vitest';
import {
  type ComponentPatch,
  type ComponentPatchesMessage,
  type EntityPatch,
  type DespawnBatch,
  type InvokeAction,
  type HoldClaim,
  type HoldRelease,
  type RequestUpdate,
  type SceneMessage,
} from './wire';

// Each wire message must JSON round-trip without loss.
function roundTrip<T>(msg: T): T {
  return JSON.parse(JSON.stringify(msg)) as T;
}

describe('wire encode/decode round-trip', () => {
  test('ComponentPatch', () => {
    const m: ComponentPatch = { entityId: 'e1', typeId: 'transform', partial: { x: 1, y: 2 } };
    expect(roundTrip(m)).toEqual(m);
  });

  test('ComponentPatchesMessage envelope', () => {
    const m: ComponentPatchesMessage = {
      type: 'component-patches',
      channel: 'unreliable',
      patches: [
        { entityId: 'a', typeId: 'transform', partial: { x: 1 } },
        { entityId: 'b', typeId: 'transform', partial: { x: 2 } },
      ],
    };
    expect(roundTrip(m)).toEqual(m);
  });

  test('EntityPatch', () => {
    const m: EntityPatch = {
      type: 'entity-patch',
      entityId: 'e1',
      partial: { name: 'X', tags: ['a'], owner: 2, privateToSeat: null, parentId: 'p', children: ['c'] },
    };
    expect(roundTrip(m)).toEqual(m);
  });

  test('DespawnBatch', () => {
    const m: DespawnBatch = { type: 'despawn-batch', entityIds: ['c1', 'c2', 'p'] };
    expect(roundTrip(m)).toEqual(m);
  });

  test('InvokeAction', () => {
    const m: InvokeAction = {
      type: 'invoke-action',
      entityId: 'e1',
      componentTypeId: 'die',
      actionId: 'roll',
      args: { count: 2 },
    };
    expect(roundTrip(m)).toEqual(m);
  });

  test('InvokeAction without args', () => {
    const m: InvokeAction = {
      type: 'invoke-action',
      entityId: 'e1',
      componentTypeId: 'die',
      actionId: 'roll',
    };
    expect(roundTrip(m)).toEqual(m);
  });

  test('HoldClaim', () => {
    const m: HoldClaim = { type: 'hold-claim', entityId: 'e1', seat: 3 };
    expect(roundTrip(m)).toEqual(m);
  });

  test('HoldRelease', () => {
    const m: HoldRelease = { type: 'hold-release', entityId: 'e1' };
    expect(roundTrip(m)).toEqual(m);
  });

  test('RequestUpdate', () => {
    const m: RequestUpdate = {
      type: 'request-update',
      entityId: 'e1',
      typeId: 'mesh',
      partial: { textureRef: 'foo.png' },
    };
    expect(roundTrip(m)).toEqual(m);
  });

  test('SceneMessage union accepts all message kinds', () => {
    const messages: SceneMessage[] = [
      { type: 'component-patches', channel: 'reliable', patches: [] },
      { type: 'entity-patch', entityId: 'e', partial: {} },
      { type: 'despawn-batch', entityIds: [] },
      { type: 'invoke-action', entityId: 'e', componentTypeId: 't', actionId: 'a' },
      { type: 'hold-claim', entityId: 'e', seat: 0 },
      { type: 'hold-release', entityId: 'e' },
      { type: 'request-update', entityId: 'e', typeId: 't', partial: {} },
    ];
    expect(messages).toHaveLength(7);
  });
});
