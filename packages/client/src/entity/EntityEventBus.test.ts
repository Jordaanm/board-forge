import { describe, test, expect, vi } from 'vitest';
import { EntityEventBus } from './EntityEventBus';

describe('EntityEventBus', () => {
  test('register + dispatch fires the listener with the payload', () => {
    const bus = new EntityEventBus();
    const cb = vi.fn();
    bus.addListener('value-changed', cb);
    bus.dispatch('value-changed', { value: '6' });
    expect(cb).toHaveBeenCalledWith({ value: '6' });
  });

  test('multi-listener fanout — every listener fires once per dispatch', () => {
    const bus = new EntityEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.addListener('e', a);
    bus.addListener('e', b);
    bus.dispatch('e', 1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('removeListener removes only the targeted callback', () => {
    const bus = new EntityEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.addListener('e', a);
    bus.addListener('e', b);

    bus.removeListener('e', a);
    bus.dispatch('e', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('dispatch with zero listeners is a no-op (no throw)', () => {
    const bus = new EntityEventBus();
    expect(() => bus.dispatch('e', 1)).not.toThrow();
  });

  test('a throwing listener does not abort the others on the same dispatch', () => {
    const reporter = vi.fn();
    const bus = new EntityEventBus(reporter);
    const a = vi.fn(() => { throw new Error('boom'); });
    const b = vi.fn();
    bus.addListener('e', a);
    bus.addListener('e', b);

    bus.dispatch('e', 1);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  test('removeListener during dispatch does not skip queued listeners', () => {
    const bus = new EntityEventBus();
    const order: string[] = [];
    const a = (): void => {
      order.push('a');
      bus.removeListener('e', b);
    };
    const b = (): void => { order.push('b'); };
    bus.addListener('e', a);
    bus.addListener('e', b);

    bus.dispatch('e', 1);
    // The dispatch iterates a snapshot, so b still fires this round.
    expect(order).toEqual(['a', 'b']);
    // But not on a subsequent dispatch.
    order.length = 0;
    bus.dispatch('e', 2);
    expect(order).toEqual(['a']);
  });
});
