// In-memory holder for a Discord OAuth token set. `getAccessToken()` returns
// the cached access token when valid, or the `EXPIRED` sentinel when the
// token is past `expiresAt - REFRESH_SKEW_MS` and no refresh callback is
// registered. When a refresh callback is registered (wired in a later
// slice), concurrent expired-token calls share one in-flight refresh
// (single-flight).
//
// Tokens never touch storage — they live in memory and die with the tab.

export interface TokenSet {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
}

export type RefreshFn = (refreshToken: string) => Promise<TokenSet>;

export const EXPIRED = Symbol('EXPIRED');
export type AccessTokenResult = string | typeof EXPIRED;

export const REFRESH_SKEW_MS = 60_000;

export class TokenStore {
  private tokens:          TokenSet | null               = null;
  private refreshFn:       RefreshFn | null              = null;
  private inflightRefresh: Promise<TokenSet> | null      = null;

  set(tokens: TokenSet): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens          = null;
    this.inflightRefresh = null;
  }

  hasTokens(): boolean {
    return this.tokens !== null;
  }

  setRefreshFn(fn: RefreshFn | null): void {
    this.refreshFn = fn;
  }

  async getAccessToken(now: number = Date.now()): Promise<AccessTokenResult> {
    if (this.tokens === null) return EXPIRED;

    if (now < this.tokens.expiresAt - REFRESH_SKEW_MS) {
      return this.tokens.accessToken;
    }

    if (this.refreshFn === null) return EXPIRED;

    // Single-flight: piggy-back on an in-progress refresh if any.
    if (this.inflightRefresh !== null) {
      try {
        return (await this.inflightRefresh).accessToken;
      } catch {
        return EXPIRED;
      }
    }

    const refreshToken = this.tokens.refreshToken;
    const promise = this.refreshFn(refreshToken)
      .then(next => { this.tokens = next; return next; })
      .finally(() => { this.inflightRefresh = null; });
    this.inflightRefresh = promise;

    try {
      return (await promise).accessToken;
    } catch {
      return EXPIRED;
    }
  }
}
