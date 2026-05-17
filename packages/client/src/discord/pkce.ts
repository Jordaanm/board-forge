// PKCE (RFC 7636) codec. Generates an S256 verifier/challenge pair and
// verifies a challenge against a verifier. Pure; uses `crypto.subtle` and
// `crypto.getRandomValues` from the WHATWG/Node global `crypto`.

import { base64UrlEncode } from './base64url';

export interface PkcePair {
  codeVerifier:  string;
  codeChallenge: string;
}

// RFC 7636 §4.1: verifier is 43–128 chars from `[A-Z][a-z][0-9]-._~`.
// 32 random bytes → base64url → 43 chars, satisfying both bounds.
const VERIFIER_BYTES = 32;

export const VERIFIER_CHARSET = /^[A-Za-z0-9\-._~]+$/;
export const VERIFIER_MIN_LEN = 43;
export const VERIFIER_MAX_LEN = 128;

export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier  = generateVerifier();
  const codeChallenge = await deriveChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

export async function deriveChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

export async function verifyChallenge(verifier: string, challenge: string): Promise<boolean> {
  return (await deriveChallenge(verifier)) === challenge;
}

function generateVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
