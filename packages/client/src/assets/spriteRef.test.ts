import { describe, test, expect } from 'vitest';
import { parseRef, serializeSpriteRef, isSpriteRef } from './spriteRef';

describe('parseRef — 2-segment slugs', () => {
  test('parses canonical 2-segment slugs', () => {
    expect(parseRef('custom:deck')).toEqual({ kind: 'slug', namespace: 'custom', body: 'deck' });
    expect(parseRef('base:placeholder/image')).toEqual({
      kind: 'slug', namespace: 'base', body: 'placeholder/image',
    });
    expect(parseRef('prim:cube')).toEqual({ kind: 'slug', namespace: 'prim', body: 'cube' });
  });

  test('rejects unknown namespaces', () => {
    expect(parseRef('weird:thing')).toBeNull();
    expect(parseRef('http:foo')).toBeNull();
  });

  test('rejects bad bodies', () => {
    expect(parseRef('custom:Bad')).toBeNull();
    expect(parseRef('custom:has space')).toBeNull();
    expect(parseRef('custom:')).toBeNull();
  });

  test('rejects non-string / empty inputs', () => {
    expect(parseRef('')).toBeNull();
    expect(parseRef(undefined)).toBeNull();
    expect(parseRef(null)).toBeNull();
    expect(parseRef(42)).toBeNull();
  });
});

describe('parseRef — 3-segment sprite refs', () => {
  test('parses sheet+index refs', () => {
    expect(parseRef('custom:deck:0')).toEqual({ kind: 'sprite', sheetSlug: 'custom:deck', index: 0 });
    expect(parseRef('custom:deck:51')).toEqual({ kind: 'sprite', sheetSlug: 'custom:deck', index: 51 });
  });

  test('rejects non-integer tails', () => {
    expect(parseRef('custom:deck:abc')).toBeNull();
    expect(parseRef('custom:deck:1.5')).toBeNull();
    expect(parseRef('custom:deck:1e2')).toBeNull();
  });

  test('rejects negative indices', () => {
    expect(parseRef('custom:deck:-1')).toBeNull();
  });

  test('rejects leading-zero indices (canonical form only)', () => {
    expect(parseRef('custom:deck:01')).toBeNull();
  });

  test('rejects 4+ segments', () => {
    expect(parseRef('custom:deck:0:extra')).toBeNull();
  });
});

describe('serializeSpriteRef', () => {
  test('round-trips with parseRef', () => {
    const ref = serializeSpriteRef('custom:deck', 7);
    expect(ref).toBe('custom:deck:7');
    expect(parseRef(ref)).toEqual({ kind: 'sprite', sheetSlug: 'custom:deck', index: 7 });
  });

  test('throws on bad index', () => {
    expect(() => serializeSpriteRef('custom:deck', -1)).toThrow();
    expect(() => serializeSpriteRef('custom:deck', 1.5)).toThrow();
  });
});

describe('isSpriteRef', () => {
  test('true only for 3-segment refs', () => {
    expect(isSpriteRef('custom:deck:0')).toBe(true);
    expect(isSpriteRef('custom:deck')).toBe(false);
    expect(isSpriteRef('http://x/a.png')).toBe(false);
  });
});
