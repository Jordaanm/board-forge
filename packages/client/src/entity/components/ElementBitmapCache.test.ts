import { describe, test, expect } from 'vitest';
import { ElementBitmapCache } from './ElementBitmapCache';

function fakeBitmap(): HTMLCanvasElement {
  return {} as HTMLCanvasElement;
}

describe('ElementBitmapCache', () => {
  test('set/get round-trip', () => {
    const cache = new ElementBitmapCache(8);
    const b = fakeBitmap();
    cache.set('k', b);
    expect(cache.get('k')).toBe(b);
    expect(cache.has('k')).toBe(true);
    expect(cache.size()).toBe(1);
  });

  test('miss returns undefined', () => {
    const cache = new ElementBitmapCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  test('LRU eviction at soft cap', () => {
    const cache = new ElementBitmapCache(3);
    cache.set('a', fakeBitmap());
    cache.set('b', fakeBitmap());
    cache.set('c', fakeBitmap());
    cache.set('d', fakeBitmap()); // evicts 'a' (oldest)
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  test('get bumps LRU position', () => {
    const cache = new ElementBitmapCache(3);
    cache.set('a', fakeBitmap());
    cache.set('b', fakeBitmap());
    cache.set('c', fakeBitmap());
    cache.get('a'); // 'a' moves to MRU
    cache.set('d', fakeBitmap()); // evicts 'b' (now oldest)
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  test('invalidate removes entry', () => {
    const cache = new ElementBitmapCache();
    cache.set('k', fakeBitmap());
    cache.invalidate('k');
    expect(cache.has('k')).toBe(false);
  });

  test('clear empties the cache', () => {
    const cache = new ElementBitmapCache();
    cache.set('a', fakeBitmap());
    cache.set('b', fakeBitmap());
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
