// React context exposing the Discord auth state and actions. Holds the
// in-memory TokenStore from #1 and the mapped DiscordProfile. signIn()
// stashes the PKCE verifier + expected nonce in sessionStorage (per-tab,
// cleared on tab close) and navigates the browser to Discord's authorize
// URL. The /auth/discord/callback page calls completeCallback() to finish
// the round-trip.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { TokenStore } from './tokenStore';
import { mapProfile, type DiscordProfile } from './profileMapper';
import { generatePkcePair } from './pkce';
import { encodeState, decodeState, generateNonce } from './oauthState';
import {
  hasCustomisedDisplayName, markDisplayNameCustomised, saveDisplayName,
} from '../identity/displayName';
import {
  DISCORD_OAUTH_AUTHORIZE_URL, DISCORD_USERS_ME_URL,
  SIGN_IN_SCOPES, SS_VERIFIER, SS_NONCE,
  getRedirectUri, getClientId, getApiUrl,
} from './authConfig';

export interface DiscordAuthContextValue {
  profile:    DiscordProfile | null;
  isSignedIn: boolean;
  signIn:     (returnUrl?: string) => Promise<void>;
  signOut:    () => void;
  // Used by DiscordCallbackPage. Returns the decoded returnUrl on success
  // so the page can navigate the user back where they came from.
  completeCallback: (code: string, stateParam: string) => Promise<string>;
}

const DiscordAuthContext = createContext<DiscordAuthContextValue | null>(null);

export function DiscordAuthProvider({ children }: { children: ReactNode }) {
  const tokenStoreRef                    = useRef<TokenStore>(new TokenStore());
  const [profile, setProfile]            = useState<DiscordProfile | null>(null);

  const signIn = useCallback(async (returnUrl?: string) => {
    const clientId = getClientId();
    if (clientId === '') {
      console.error('[discord-auth] VITE_DISCORD_CLIENT_ID is not set');
      return;
    }
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    const nonce      = generateNonce();
    const target     = returnUrl ?? window.location.href;
    const stateParam = encodeState({ returnUrl: target, nonce });

    try {
      sessionStorage.setItem(SS_VERIFIER, codeVerifier);
      sessionStorage.setItem(SS_NONCE,    nonce);
    } catch (err) {
      console.error('[discord-auth] sessionStorage.setItem threw', err);
      return;
    }

    const url = new URL(DISCORD_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('response_type',         'code');
    url.searchParams.set('client_id',             clientId);
    url.searchParams.set('redirect_uri',          getRedirectUri());
    url.searchParams.set('scope',                 SIGN_IN_SCOPES);
    url.searchParams.set('code_challenge',        codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state',                 stateParam);
    window.location.assign(url.toString());
  }, []);

  const signOut = useCallback(() => {
    tokenStoreRef.current.clear();
    setProfile(null);
  }, []);

  const completeCallback = useCallback(async (code: string, stateParam: string): Promise<string> => {
    const decoded = decodeState(stateParam);
    if (decoded === null) throw new Error('invalid_state');

    let expectedNonce: string | null;
    let storedVerifier: string | null;
    try {
      expectedNonce  = sessionStorage.getItem(SS_NONCE);
      storedVerifier = sessionStorage.getItem(SS_VERIFIER);
    } catch (err) {
      console.error('[discord-auth] sessionStorage.getItem threw', err);
      throw new Error('storage_unavailable');
    }
    if (expectedNonce === null || storedVerifier === null) throw new Error('missing_pkce_state');
    if (decoded.nonce !== expectedNonce) throw new Error('nonce_mismatch');

    // Exchange the authorization code for tokens.
    const exchangeRes = await fetch(`${getApiUrl()}/oauth/discord/exchange`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'authorization_code',
        code,
        code_verifier: storedVerifier,
        redirect_uri:  getRedirectUri(),
      }),
    });
    if (!exchangeRes.ok) throw new Error(`exchange_failed_${exchangeRes.status}`);
    const tokenBody = await exchangeRes.json() as {
      access_token?:  unknown;
      refresh_token?: unknown;
      expires_in?:    unknown;
    };
    if (typeof tokenBody.access_token !== 'string' || typeof tokenBody.expires_in !== 'number') {
      throw new Error('exchange_invalid');
    }
    const accessToken  = tokenBody.access_token;
    const refreshToken = typeof tokenBody.refresh_token === 'string' ? tokenBody.refresh_token : '';
    const expiresAt    = Date.now() + tokenBody.expires_in * 1000;
    tokenStoreRef.current.set({ accessToken, refreshToken, expiresAt });

    // Fetch the Discord profile.
    const profileRes = await fetch(DISCORD_USERS_ME_URL, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) throw new Error(`profile_failed_${profileRes.status}`);
    const rawProfile = await profileRes.json() as unknown;
    const mapped     = mapProfile(rawProfile);
    if (mapped === null) throw new Error('profile_invalid');

    // Seed the local display name from Discord on first sign-in. The
    // customised flag covers both an explicit pick in the first-run prompt
    // and a previously-seeded sign-in, so we never clobber either.
    if (!hasCustomisedDisplayName()) {
      saveDisplayName(mapped.displayNameSeed);
      markDisplayNameCustomised();
    }
    setProfile(mapped);

    // PKCE round-trip done; clear the one-shot state.
    try {
      sessionStorage.removeItem(SS_VERIFIER);
      sessionStorage.removeItem(SS_NONCE);
    } catch { /* ignore */ }

    return decoded.returnUrl;
  }, []);

  const value = useMemo<DiscordAuthContextValue>(() => ({
    profile,
    isSignedIn: profile !== null,
    signIn,
    signOut,
    completeCallback,
  }), [profile, signIn, signOut, completeCallback]);

  return (
    <DiscordAuthContext.Provider value={value}>{children}</DiscordAuthContext.Provider>
  );
}

export function useDiscordAuth(): DiscordAuthContextValue {
  const ctx = useContext(DiscordAuthContext);
  if (ctx === null) throw new Error('useDiscordAuth must be used inside <DiscordAuthProvider>');
  return ctx;
}
