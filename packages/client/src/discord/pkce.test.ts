import { describe, test, expect } from 'vitest';
import {
  deriveChallenge,
  generatePkcePair,
  verifyChallenge,
  VERIFIER_CHARSET,
  VERIFIER_MAX_LEN,
  VERIFIER_MIN_LEN,
} from './pkce';

describe('PKCE codec', () => {
  // RFC 7636 Appendix B fixture.
  const RFC_VERIFIER  = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  test('deriveChallenge matches RFC 7636 Appendix B fixture', async () => {
    expect(await deriveChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  test('verifyChallenge accepts a matching pair', async () => {
    expect(await verifyChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  test('verifyChallenge rejects a mismatched pair', async () => {
    expect(await verifyChallenge(RFC_VERIFIER, 'not-the-challenge')).toBe(false);
    expect(await verifyChallenge('wrong-verifier', RFC_CHALLENGE)).toBe(false);
  });

  test('generatePkcePair round-trips through verifyChallenge', async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    expect(await verifyChallenge(codeVerifier, codeChallenge)).toBe(true);
  });

  test('generated verifier conforms to RFC 7636 charset and length', async () => {
    for (let i = 0; i < 10; i++) {
      const { codeVerifier } = await generatePkcePair();
      expect(codeVerifier.length).toBeGreaterThanOrEqual(VERIFIER_MIN_LEN);
      expect(codeVerifier.length).toBeLessThanOrEqual(VERIFIER_MAX_LEN);
      expect(codeVerifier).toMatch(VERIFIER_CHARSET);
    }
  });

  test('generated pairs are unique across calls', async () => {
    const a = await generatePkcePair();
    const b = await generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});
