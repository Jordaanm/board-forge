// Shared constants for the Discord OAuth flow.

export const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_USERS_ME_URL        = 'https://discord.com/api/users/@me';

// Per the PRD: minimal scope. RPC consent comes via the AUTHORIZE flow later.
export const SIGN_IN_SCOPES = 'identify';

// sessionStorage keys for the PKCE round-trip. Per-tab, cleared on tab close.
export const SS_VERIFIER = 'vt:discord:pkce:verifier';
export const SS_NONCE    = 'vt:discord:pkce:nonce';

export function getRedirectUri(): string {
  return `${window.location.origin}/auth/discord/callback`;
}

export function getClientId(): string {
  return import.meta.env.VITE_DISCORD_CLIENT_ID ?? '';
}

export function getApiUrl(): string {
  return import.meta.env.VITE_API_URL;
}
