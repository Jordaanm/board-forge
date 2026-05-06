import { describe, test, expect, vi } from 'vitest';
import { ScriptErrorLog } from './ScriptErrorLog';

describe('ScriptErrorLog', () => {
  test('push records source + first stack line and exposes a list snapshot', () => {
    const log = new ScriptErrorLog();
    const e = new Error('boom');
    log.push('onScriptLoaded', e);
    const list = log.list();
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe('onScriptLoaded');
    expect(list[0].firstLine).toContain('boom');
    expect(typeof list[0].timestamp).toBe('number');
  });

  test('list() returns a defensive copy — mutating it does not affect the log', () => {
    const log = new ScriptErrorLog();
    log.push('s', new Error('a'));
    const snap = log.list();
    snap.length = 0;
    expect(log.list()).toHaveLength(1);
  });

  test('push beyond the cap drops the oldest entry; ordering preserved', () => {
    const log = new ScriptErrorLog(3);
    log.push('s', new Error('msg-alpha'));
    log.push('s', new Error('msg-beta'));
    log.push('s', new Error('msg-gamma'));
    log.push('s', new Error('msg-delta'));
    const messages = log.list().map(e => e.firstLine);
    expect(messages.some(s => s.includes('msg-alpha'))).toBe(false);
    expect(messages[0]).toContain('msg-beta');
    expect(messages[1]).toContain('msg-gamma');
    expect(messages[2]).toContain('msg-delta');
    expect(log.size()).toBe(3);
  });

  test('clear() empties the list', () => {
    const log = new ScriptErrorLog();
    log.push('s', new Error('a'));
    log.clear();
    expect(log.list()).toEqual([]);
  });

  test('subscribers fire on push and on clear', () => {
    const log = new ScriptErrorLog();
    const cb = vi.fn();
    const unsub = log.subscribe(cb);

    log.push('s', new Error('a'));
    log.push('s', new Error('b'));
    log.clear();
    expect(cb).toHaveBeenCalledTimes(3);

    unsub();
    log.push('s', new Error('c'));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  test('a throwing subscriber does not break the log', () => {
    const log = new ScriptErrorLog();
    log.subscribe(() => { throw new Error('subscriber-boom'); });
    expect(() => log.push('s', new Error('x'))).not.toThrow();
  });

  test('falls back to String(error) for non-Error throws', () => {
    const log = new ScriptErrorLog();
    log.push('s', 'plain string');
    expect(log.list()[0].firstLine).toBe('plain string');
  });
});
