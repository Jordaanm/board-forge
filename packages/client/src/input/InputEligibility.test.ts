// Unit tests for InputEligibility — issue #1 of issues--interaction.md.
//
// Five branches of `isEligibleForInput` exercised independently. Uses real
// `Entity` instances + a `TableComponent` attached directly to bypass spawn
// lifecycle (no SceneImpl / SpawnContext required).

import { describe, test, expect } from 'vitest';
import { Entity } from '../entity/Entity';
import { TableComponent } from '../entity/components/TableComponent';
import { isEligibleForInput } from './InputEligibility';

function makeEntity(): Entity {
  return new Entity({ id: 'e', type: 'token', name: 'e' });
}

describe('isEligibleForInput', () => {
  test('default entity is eligible', () => {
    const e = makeEntity();
    expect(isEligibleForInput(e, 0)).toBe(true);
    expect(isEligibleForInput(e, null)).toBe(true);
  });

  test('isContained → ineligible', () => {
    const e = makeEntity();
    e.isContained = true;
    expect(isEligibleForInput(e, 0)).toBe(false);
  });

  test('TableComponent present → ineligible', () => {
    const e = makeEntity();
    e.attachComponent(new TableComponent());
    expect(isEligibleForInput(e, 0)).toBe(false);
  });

  test('privateToSeat = 2, viewer seat = 1 → ineligible', () => {
    const e = makeEntity();
    e.privateToSeat = 2;
    expect(isEligibleForInput(e, 1)).toBe(false);
  });

  test('privateToSeat = 2, viewer seat = 2 → eligible', () => {
    const e = makeEntity();
    e.privateToSeat = 2;
    expect(isEligibleForInput(e, 2)).toBe(true);
  });

  test('privateToSeat set, viewer unseated → ineligible', () => {
    const e = makeEntity();
    e.privateToSeat = 0;
    expect(isEligibleForInput(e, null)).toBe(false);
  });
});
