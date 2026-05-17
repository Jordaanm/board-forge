// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { RichPresenceController } from './RichPresenceController';

interface FakeWsInstance {
  url:        string;
  protocols:  string | string[] | undefined;
  sent:       string[];
  closed:     boolean;
  listeners:  Map<string, ((e: unknown) => void)[]>;
  dispatch:   (type: string, e?: unknown) => void;
}

const ORIGINAL_WS  = globalThis.WebSocket;
const FETCH        = globalThis.fetch;

// Builds a WebSocket stand-in factory plus a list to capture every instance
// created during the test, so we can drive `open` / `message` / `close`
// from the outside.
function installFakeWebSocket(handler: (instance: FakeWsInstance) => void) {
  const instances: FakeWsInstance[] = [];
  class FakeWs {
    static readonly OPEN = 1;
    readyState = 0;
    constructor(url: string, protocols?: string | string[]) {
      const listeners = new Map<string, ((e: unknown) => void)[]>();
      const instance: FakeWsInstance = {
        url, protocols, sent: [], closed: false, listeners,
        dispatch: (type, e) => {
          const ls = listeners.get(type) ?? [];
          for (const l of ls) l(e ?? {});
        },
      };
      instances.push(instance);
      // expose via the constructed object so test callers can talk to it.
      (this as unknown as { __i: FakeWsInstance }).__i = instance;
      // Defer to give the caller the instance before any sync event fires.
      queueMicrotask(() => handler(instance));
    }
    addEventListener(type: string, listener: (e: unknown) => void, _opts?: unknown): void {
      const i = (this as unknown as { __i: FakeWsInstance }).__i;
      const ls = i.listeners.get(type) ?? [];
      ls.push(listener);
      i.listeners.set(type, ls);
    }
    removeEventListener(type: string, listener: (e: unknown) => void): void {
      const i = (this as unknown as { __i: FakeWsInstance }).__i;
      const ls = (i.listeners.get(type) ?? []).filter(l => l !== listener);
      i.listeners.set(type, ls);
    }
    send(data: string): void {
      const i = (this as unknown as { __i: FakeWsInstance }).__i;
      i.sent.push(data);
    }
    close(): void {
      const i = (this as unknown as { __i: FakeWsInstance }).__i;
      i.closed = true;
    }
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWs;
  return { instances };
}

describe('RichPresenceController', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = ORIGINAL_WS;
    globalThis.fetch = FETCH;
  });

  test('walks through AUTHORIZE → exchange → AUTHENTICATE → SET_ACTIVITY', async () => {
    const { instances } = installFakeWebSocket((inst) => {
      inst.dispatch('open');
    });

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'AT', expires_in: 600 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    const ctrl = new RichPresenceController();
    ctrl.start({
      roomName: 'Catan', playerCount: 2, capacity: 8, joinedAtMs: 1234, logoKey: 'logo',
    });

    // Wait microtasks for queueMicrotask + open dispatch + AUTHORIZE send.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const inst = instances[0];
    expect(inst).toBeDefined();
    const authorize = JSON.parse(inst.sent[0]) as { cmd: string; args: { client_id: string; scopes: string[] } };
    expect(authorize.cmd).toBe('AUTHORIZE');
    expect(authorize.args.scopes).toEqual(['rpc.activities.write']);

    // Deliver an AUTHORIZE response with a code.
    inst.dispatch('message', { data: JSON.stringify({ cmd: 'AUTHORIZE', data: { code: 'rpc-code' } }) });
    // Let the async exchange + AUTHENTICATE send settle.
    for (let i = 0; i < 10 && inst.sent.length < 2; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }

    const authenticate = JSON.parse(inst.sent[1]) as { cmd: string; args: { access_token: string } };
    expect(authenticate.cmd).toBe('AUTHENTICATE');
    expect(authenticate.args.access_token).toBe('AT');

    inst.dispatch('message', { data: JSON.stringify({ cmd: 'AUTHENTICATE', data: { user: { id: 'x' } } }) });
    for (let i = 0; i < 10 && inst.sent.length < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }

    const setActivity = JSON.parse(inst.sent[2]) as { cmd: string; args: { activity: { details: string; state: string } } };
    expect(setActivity.cmd).toBe('SET_ACTIVITY');
    expect(setActivity.args.activity.details).toBe('In Room: Catan');
    expect(setActivity.args.activity.state).toBe('2/8 players');

    ctrl.stop();
  });

  test('exhausting port range without a successful open is a silent no-op', async () => {
    const { instances } = installFakeWebSocket((inst) => {
      inst.dispatch('error');
    });

    const ctrl = new RichPresenceController();
    expect(() => ctrl.start({
      roomName: 'X', playerCount: 1, capacity: 8, joinedAtMs: 0, logoKey: 'k',
    })).not.toThrow();

    // Drain queueMicrotask + error → tryConnect chain through 10 ports.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
    // 10 ports tried (6463-6472).
    expect(instances.length).toBe(10);
    ctrl.stop();
  });
});
