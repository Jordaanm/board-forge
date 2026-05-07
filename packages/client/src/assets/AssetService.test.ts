import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { AssetService, type AssetStatus, getImagePlaceholder } from './AssetService';
import { Manifest, type AssetEntry } from './Manifest';
import { BASE_MANIFEST, PRIMITIVE_MANIFEST } from './baseManifest';

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

describe('AssetService slug resolution', () => {
  test('resolves a custom slug through the manifest to its URL', async () => {
    const real = new THREE.Texture();
    let loaded = '';
    const custom: AssetEntry = {
      slug:    'custom:my-img',
      name:    'My',
      type:    'image',
      url:     'http://example.com/c.png',
      preload: true,
    };
    const svc = new AssetService({
      manifests:   [Manifest.from([custom])],
      imageLoader: (url) => { loaded = url; return Promise.resolve(real); },
    });

    const tex = await svc.resolve('custom:my-img', 'image');
    expect(loaded).toBe('http://example.com/c.png');
    expect(tex).toBe(real);
  });

  test('unknown slug → placeholder + broken status', async () => {
    const svc   = new AssetService({ manifests: [BASE_MANIFEST] });
    const calls: AssetStatus[] = [];
    svc.subscribe('custom:nope', 'image', (_tex, status) => calls.push(status));
    await flushMicrotasks();
    expect(calls[calls.length - 1]).toBe('broken');
    expect(svc.status('custom:nope', 'image')).toBe('broken');
  });

  test('wrong-type slug → placeholder + broken status', async () => {
    const svc   = new AssetService({ manifests: [BASE_MANIFEST, PRIMITIVE_MANIFEST] });
    const calls: AssetStatus[] = [];
    svc.subscribe('prim:cube', 'image', (_tex, status) => calls.push(status));
    await flushMicrotasks();
    expect(calls[calls.length - 1]).toBe('broken');
  });

  test('base placeholder slug → placeholder texture, loaded status', async () => {
    const svc   = new AssetService({ manifests: [BASE_MANIFEST] });
    const calls: { tex: THREE.Texture; status: AssetStatus }[] = [];
    svc.subscribe('base:placeholder/image', 'image', (tex, status) => calls.push({ tex, status }));
    await flushMicrotasks();
    const last = calls[calls.length - 1];
    expect(last?.status).toBe('loaded');
    expect(last?.tex).toBe(getImagePlaceholder());
  });

  test('placeholder:// marker URL never hits the network loader', async () => {
    let loaded = 0;
    const svc = new AssetService({
      manifests:   [BASE_MANIFEST],
      imageLoader: () => { loaded++; return Promise.resolve(new THREE.Texture()); },
    });
    svc.subscribe('placeholder://image', 'image', () => {});
    await flushMicrotasks();
    expect(loaded).toBe(0);
  });

  test('setManifests evicts cached slug entries so re-resolve picks up the new URL', async () => {
    const t1 = new THREE.Texture();
    const t2 = new THREE.Texture();
    const svc = new AssetService({
      imageLoader: (url) => Promise.resolve(url.endsWith('a.png') ? t1 : t2),
    });
    svc.setManifests([Manifest.from([{
      slug: 'custom:swap', name: 'A', type: 'image', url: 'http://x/a.png', preload: false,
    }])]);
    expect(await svc.resolve('custom:swap', 'image')).toBe(t1);

    svc.setManifests([Manifest.from([{
      slug: 'custom:swap', name: 'A', type: 'image', url: 'http://x/b.png', preload: false,
    }])]);
    expect(await svc.resolve('custom:swap', 'image')).toBe(t2);
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
