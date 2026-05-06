import { describe, test, expect, vi } from 'vitest';
import { Entity } from '../Entity';
import { ValueComponent } from './ValueComponent';

function makeEntityWithValue(value: string, isNumeric = true): Entity {
  const e = new Entity({ id: 'd-1', type: 'die', name: 'Die-d-1' });
  const c = new ValueComponent();
  c.fromJSON({ value, isNumeric });
  e.attachComponent(c);
  return e;
}

describe('ValueComponent — value-changed dispatch', () => {
  test('fires value-changed when setState changes the value', () => {
    const e = makeEntityWithValue('1');
    const cb = vi.fn();
    e.addEventListener('value-changed', cb);

    e.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
    expect(cb).toHaveBeenCalledWith({ value: '6', isNumeric: true });
  });

  test('does NOT dispatch when setState resolves the same value', () => {
    const e = makeEntityWithValue('6');
    const cb = vi.fn();
    e.addEventListener('value-changed', cb);

    e.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
    expect(cb).not.toHaveBeenCalled();
  });

  test('does NOT dispatch when setState patches only isNumeric', () => {
    const e = makeEntityWithValue('1');
    const cb = vi.fn();
    e.addEventListener('value-changed', cb);

    e.getComponent(ValueComponent)!.setState({ isNumeric: false });
    expect(cb).not.toHaveBeenCalled();
  });

  test('applyRemoteState (guest path) also fires value-changed on change', () => {
    const e = makeEntityWithValue('1');
    const cb = vi.fn();
    e.addEventListener('value-changed', cb);

    e.getComponent(ValueComponent)!.applyRemoteState({ value: '4', isNumeric: true });
    expect(cb).toHaveBeenCalledWith({ value: '4', isNumeric: true });
  });
});
