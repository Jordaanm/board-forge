import { describe, test, expect, vi } from 'vitest';
import {
  EXPIRED,
  REFRESH_SKEW_MS,
  TokenStore,
  type RefreshFn,
  type TokenSet,
} from './tokenStore';

const T0 = 1_700_000_000_000;

function tokens(over: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken:  'at-1',
    refreshToken: 'rt-1',
    expiresAt:    T0 + 3_600_000,
    ...over,
  };
}

describe('TokenStore', () => {
  test('returns EXPIRED before any tokens are set', async () => {
    const store = new TokenStore();
    expect(await store.getAccessToken(T0)).toBe(EXPIRED);
  });

  test('returns the cached access token when not yet expired', async () => {
    const store = new TokenStore();
    store.set(tokens({ accessToken: 'fresh', expiresAt: T0 + 600_000 }));
    expect(await store.getAccessToken(T0)).toBe('fresh');
  });

  test('returns EXPIRED past expiry when no refresh callback is registered', async () => {
    const store = new TokenStore();
    store.set(tokens({ expiresAt: T0 - 1 }));
    expect(await store.getAccessToken(T0)).toBe(EXPIRED);
  });

  test('refresh triggers within the skew window (before raw expiry)', async () => {
    const store = new TokenStore();
    store.set(tokens({ accessToken: 'old', expiresAt: T0 + REFRESH_SKEW_MS - 1 }));
    const refresh: RefreshFn = vi.fn(async () => tokens({
      accessToken: 'new', expiresAt: T0 + 3_600_000,
    }));
    store.setRefreshFn(refresh);
    expect(await store.getAccessToken(T0)).toBe('new');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('returns cached token when comfortably inside the skew window', async () => {
    const store = new TokenStore();
    store.set(tokens({ accessToken: 'fresh', expiresAt: T0 + REFRESH_SKEW_MS + 60_000 }));
    const refresh: RefreshFn = vi.fn(async () => {
      throw new Error('should not be called');
    });
    store.setRefreshFn(refresh);
    expect(await store.getAccessToken(T0)).toBe('fresh');
    expect(refresh).not.toHaveBeenCalled();
  });

  test('concurrent expired-token getters share one refresh (single-flight)', async () => {
    const store = new TokenStore();
    store.set(tokens({ expiresAt: T0 - 1 }));

    let resolveRefresh: (t: TokenSet) => void = () => {};
    const refreshPromise = new Promise<TokenSet>(r => { resolveRefresh = r; });
    const refresh: RefreshFn = vi.fn(() => refreshPromise);
    store.setRefreshFn(refresh);

    const a = store.getAccessToken(T0);
    const b = store.getAccessToken(T0);
    const c = store.getAccessToken(T0);

    resolveRefresh(tokens({ accessToken: 'refreshed', expiresAt: T0 + 3_600_000 }));

    expect(await a).toBe('refreshed');
    expect(await b).toBe('refreshed');
    expect(await c).toBe('refreshed');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('refresh failure: all concurrent waiters resolve to EXPIRED', async () => {
    const store = new TokenStore();
    store.set(tokens({ expiresAt: T0 - 1 }));

    let rejectRefresh: (e: Error) => void = () => {};
    const refreshPromise = new Promise<TokenSet>((_r, rej) => { rejectRefresh = rej; });
    const refresh: RefreshFn = vi.fn(() => refreshPromise);
    store.setRefreshFn(refresh);

    const a = store.getAccessToken(T0);
    const b = store.getAccessToken(T0);

    rejectRefresh(new Error('revoked'));

    expect(await a).toBe(EXPIRED);
    expect(await b).toBe(EXPIRED);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a second refresh runs after the first completes (inflight cleared)', async () => {
    const store = new TokenStore();
    store.set(tokens({ accessToken: 'v1', expiresAt: T0 - 1 }));
    const refresh: RefreshFn = vi.fn(async (prevRt: string) => tokens({
      accessToken:  `${prevRt}->v2`,
      refreshToken: 'rt-2',
      expiresAt:    T0 - 1,
    }));
    store.setRefreshFn(refresh);

    expect(await store.getAccessToken(T0)).toBe('rt-1->v2');

    // Tokens are still expired, so the next call should fire refresh again
    // using the *new* refresh token from the previous round.
    expect(await store.getAccessToken(T0)).toBe('rt-2->v2');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('clear() drops tokens and any inflight refresh state', async () => {
    const store = new TokenStore();
    store.set(tokens());
    expect(store.hasTokens()).toBe(true);
    store.clear();
    expect(store.hasTokens()).toBe(false);
    expect(await store.getAccessToken(T0)).toBe(EXPIRED);
  });

  test('hasTokens reflects set/clear', () => {
    const store = new TokenStore();
    expect(store.hasTokens()).toBe(false);
    store.set(tokens());
    expect(store.hasTokens()).toBe(true);
    store.clear();
    expect(store.hasTokens()).toBe(false);
  });
});
