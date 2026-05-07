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

describe('AssetService.preload', () => {
  test('fetches every preload:true entry across the supplied manifests', async () => {
    const fetched: string[] = [];
    const real = new THREE.Texture();
    const svc  = new AssetService({
      imageLoader: (url) => { fetched.push(url); return Promise.resolve(real); },
    });
    const m = Manifest.from([
      { slug: 'custom:a', name: 'A', type: 'image', url: 'http://x/a.png', preload: true  },
      { slug: 'custom:b', name: 'B', type: 'image', url: 'http://x/b.png', preload: false },
      { slug: 'custom:c', name: 'C', type: 'image', url: 'http://x/c.png', preload: true  },
    ]);
    svc.setManifests([m]);

    await svc.preload(m);
    expect(fetched.sort()).toEqual(['http://x/a.png', 'http://x/c.png']);
  });

  test('skips placeholder:// and primitive:// markers (no network)', async () => {
    let calls = 0;
    const svc = new AssetService({
      imageLoader: () => { calls++; return Promise.resolve(new THREE.Texture()); },
    });
    await svc.preload([BASE_MANIFEST, PRIMITIVE_MANIFEST]);
    expect(calls).toBe(0);
  });

  test('non-image entries are skipped (no model/sound loader yet)', async () => {
    let calls = 0;
    const svc = new AssetService({
      imageLoader: () => { calls++; return Promise.resolve(new THREE.Texture()); },
    });
    const m = Manifest.from([
      { slug: 'custom:m', name: 'M', type: 'model', url: 'http://x/m.glb', preload: true },
      { slug: 'custom:s', name: 'S', type: 'sound', url: 'http://x/s.mp3', preload: true },
    ]);
    svc.setManifests([m]);
    await svc.preload(m);
    expect(calls).toBe(0);
  });

  test('settles even when individual loads reject', async () => {
    const svc = new AssetService({
      imageLoader: (url) => url.endsWith('ok.png')
        ? Promise.resolve(new THREE.Texture())
        : Promise.reject(new Error('boom')),
    });
    const m = Manifest.from([
      { slug: 'custom:ok',  name: 'OK',  type: 'image', url: 'http://x/ok.png',  preload: true },
      { slug: 'custom:bad', name: 'BAD', type: 'image', url: 'http://x/bad.png', preload: true },
    ]);
    svc.setManifests([m]);

    await expect(svc.preload(m)).resolves.toBeUndefined();
    expect(svc.status('custom:ok',  'image')).toBe('loaded');
    expect(svc.status('custom:bad', 'image')).toBe('broken');
  });

  test('progress listener tracks pending count and returns to zero', async () => {
    let resolveLoad!: (tex: THREE.Texture) => void;
    const svc = new AssetService({
      imageLoader: () => new Promise((r) => { resolveLoad = r; }),
    });
    const m = Manifest.from([
      { slug: 'custom:p', name: 'P', type: 'image', url: 'http://x/p.png', preload: true },
    ]);
    svc.setManifests([m]);

    const seen: number[] = [];
    svc.subscribeProgress((n) => seen.push(n));
    expect(seen).toEqual([0]);

    const done = svc.preload(m);
    expect(seen[seen.length - 1]).toBe(1);
    expect(svc.pendingCount()).toBe(1);

    resolveLoad(new THREE.Texture());
    await done;
    expect(seen[seen.length - 1]).toBe(0);
    expect(svc.pendingCount()).toBe(0);
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

  test('broken → loaded transition after invalidate (e.g. host fixes URL)', async () => {
    let attempt = 0;
    const real = new THREE.Texture();
    const svc = new AssetService({
      imageLoader: () =>
        attempt++ === 0 ? Promise.reject(new Error('404')) : Promise.resolve(real),
    });
    const seen: AssetStatus[] = [];
    svc.subscribe('http://x/heal.png', 'image', (_tex, s) => seen.push(s));
    await flushMicrotasks();
    expect(seen).toEqual(['pending', 'broken']);

    svc.invalidate('http://x/heal.png');
    await flushMicrotasks();
    expect(seen).toEqual(['pending', 'broken', 'pending', 'loaded']);
    expect(svc.status('http://x/heal.png', 'image')).toBe('loaded');
  });

  test('setManifests re-fetches cached slugs through invalidate, preserving listeners', async () => {
    const t1 = new THREE.Texture();
    const t2 = new THREE.Texture();
    let attempt = 0;
    const svc = new AssetService({
      imageLoader: () => Promise.resolve(attempt++ === 0 ? t1 : t2),
    });
    svc.setManifests([Manifest.from([{
      slug: 'custom:x', name: 'X', type: 'image', url: 'http://x/old.png', preload: false,
    }])]);

    const seen: { tex: THREE.Texture; status: AssetStatus }[] = [];
    svc.subscribe('custom:x', 'image', (tex, status) => seen.push({ tex, status }));
    await flushMicrotasks();
    expect(seen[seen.length - 1].tex).toBe(t1);

    svc.setManifests([Manifest.from([{
      slug: 'custom:x', name: 'X', type: 'image', url: 'http://x/new.png', preload: false,
    }])]);
    await flushMicrotasks();
    // Listener survives — observes pending then the new texture.
    expect(seen[seen.length - 1].tex).toBe(t2);
    expect(seen[seen.length - 1].status).toBe('loaded');
  });
});
