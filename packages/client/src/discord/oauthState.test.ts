import { describe, test, expect } from 'vitest';
import { decodeState, encodeState, generateNonce } from './oauthState';

describe('OAuth state codec', () => {
  test('round-trips a simple payload', () => {
    const payload = { returnUrl: 'https://example.com/', nonce: 'abc123' };
    expect(decodeState(encodeState(payload))).toEqual(payload);
  });

  test('round-trips URLs with query strings + hashes', () => {
    const returnUrl = 'https://example.com/r/abc-123?host=1&pwd=x#section';
    const payload   = { returnUrl, nonce: 'n' };
    expect(decodeState(encodeState(payload))).toEqual(payload);
  });

  test('round-trips unicode in returnUrl and nonce', () => {
    const payload = { returnUrl: 'https://example.com/?name=🎲', nonce: 'wéird' };
    expect(decodeState(encodeState(payload))).toEqual(payload);
  });

  test('decodeState returns null on tampered base64', () => {
    const ok       = encodeState({ returnUrl: 'https://a/', nonce: 'n' });
    const tampered = ok.slice(0, -2) + '!!';
    expect(decodeState(tampered)).toBeNull();
  });

  test('decodeState returns null on empty input', () => {
    expect(decodeState('')).toBeNull();
  });

  test('decodeState returns null on non-JSON payload', () => {
    // base64url("not-json")
    expect(decodeState('bm90LWpzb24')).toBeNull();
  });

  test('decodeState returns null when returnUrl is missing', () => {
    const fake = encodeState({ returnUrl: 'x', nonce: 'n' }).replace(/./, '');
    // Construct a payload directly: { nonce: 'n' } — no returnUrl
    const bytes = new TextEncoder().encode(JSON.stringify({ nonce: 'n' }));
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    const enc = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeState(enc)).toBeNull();
    // The `fake` line above just exercises that the helper is wired; the
    // actual assertion is on `enc`.
    void fake;
  });

  test('decodeState returns null when nonce is missing', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ returnUrl: 'https://a/' }));
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    const enc = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeState(enc)).toBeNull();
  });

  test('decodeState returns null when fields are empty strings', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ returnUrl: '', nonce: '' }));
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    const enc = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeState(enc)).toBeNull();
  });

  test('generateNonce produces unique URL-safe strings', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});
