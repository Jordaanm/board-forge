import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { AssetService, type AssetStatus, getImagePlaceholder } from './AssetService';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('AssetService.subscribe', () => {
  test('fires immediately with pending placeholder, then with the real texture', async () => {
    const real = new THREE.Texture();
    const svc  = new AssetService({ imageLoader: () => Promise.resolve(real) });
    const calls: { tex: THREE.Texture; status: AssetStatus }[] = [];

    svc.subscribe('http://x/a.png', 'image', (tex, status) => {
      calls.push({ tex, status });
    });

    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe('pending');
    expect(calls[0].tex).toBe(getImagePlaceholder());

    await flushMicrotasks();
    expect(calls.length).toBe(2);
    expect(calls[1].status).toBe('loaded');
    expect(calls[1].tex).toBe(real);
  });

  test('falls back to placeholder when the loader rejects', async () => {
    const svc   = new AssetService({ imageLoader: () => Promise.reject(new Error('boom')) });
    const calls: AssetStatus[] = [];

    svc.subscribe('http://x/bad.png', 'image', (_tex, status) => calls.push(status));

    await flushMicrotasks();
    expect(calls).toEqual(['pending', 'broken']);
    expect(svc.status('http://x/bad.png', 'image')).toBe('broken');
  });

  test('dedups concurrent subscribes — same ref triggers one loader call', async () => {
    let calls = 0;
    const real = new THREE.Texture();
    const svc  = new AssetService({
      imageLoader: () => { calls++; return Promise.resolve(real); },
    });

    svc.subscribe('http://x/dedup.png', 'image', () => {});
    svc.subscribe('http://x/dedup.png', 'image', () => {});
    svc.subscribe('http://x/dedup.png', 'image', () => {});

    await flushMicrotasks();
    expect(calls).toBe(1);
  });

  test('a later subscribe to a loaded ref fires once with the cached texture', async () => {
    const real = new THREE.Texture();
    const svc  = new AssetService({ imageLoader: () => Promise.resolve(real) });

    svc.subscribe('http://x/cached.png', 'image', () => {});
    await flushMicrotasks();

    const calls: { tex: THREE.Texture; status: AssetStatus }[] = [];
    svc.subscribe('http://x/cached.png', 'image', (tex, status) => calls.push({ tex, status }));

    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe('loaded');
    expect(calls[0].tex).toBe(real);
  });

  test('unsubscribe stops further notifications for that listener', async () => {
    let pending: ((tex: THREE.Texture) => void) | null = null;
    const svc = new AssetService({
      imageLoader: () => new Promise((res) => { pending = res; }),
    });
    const calls: AssetStatus[] = [];

    const unsub = svc.subscribe('http://x/late.png', 'image', (_tex, status) => calls.push(status));
    unsub();
    pending!(new THREE.Texture());
    await flushMicrotasks();

    expect(calls).toEqual(['pending']);
  });
});

describe('AssetService.resolve', () => {
  test('resolves with the real texture on success', async () => {
    const real = new THREE.Texture();
    const svc  = new AssetService({ imageLoader: () => Promise.resolve(real) });
    const tex  = await svc.resolve('http://x/r.png', 'image');
    expect(tex).toBe(real);
  });

  test('resolves with the placeholder on failure (never rejects)', async () => {
    const svc = new AssetService({ imageLoader: () => Promise.reject(new Error('boom')) });
    const tex = await svc.resolve('http://x/r.png', 'image');
    expect(tex).toBe(getImagePlaceholder());
  });
});

describe('AssetService.invalidate', () => {
  test('re-fetches and notifies existing subscribers', async () => {
    let calls = 0;
    const t1 = new THREE.Texture();
    const t2 = new THREE.Texture();
    const svc = new AssetService({
      imageLoader: () => Promise.resolve(calls++ === 0 ? t1 : t2),
    });
    const seen: AssetStatus[] = [];
    svc.subscribe('http://x/inv.png', 'image', (_tex, status) => seen.push(status));

    await flushMicrotasks();
    expect(seen).toEqual(['pending', 'loaded']);

    svc.invalidate('http://x/inv.png');
    await flushMicrotasks();
    expect(seen).toEqual(['pending', 'loaded', 'pending', 'loaded']);
    expect(calls).toBe(2);
  });
});
