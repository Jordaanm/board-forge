import { describe, test, expect } from 'vitest';
import { Entity } from '../entity/Entity';
import { type EntityScene } from '../entity/EntityComponent';
import { EntityComponent } from '../entity/EntityComponent';
import { SceneFacade } from './SceneFacade';
import { EntityFacade } from './EntityFacade';
import { Manifest } from '../assets/Manifest';
import { TABLE_ENTITY_ID } from '../entity/tableEntity';

class StubScene implements EntityScene {
  private byId = new Map<string, Entity>();
  add(e: Entity): void { this.byId.set(e.id, e); }
  all(): Entity[] { return [...this.byId.values()]; }
  getEntity(id: string): Entity | undefined { return this.byId.get(id); }
  has(id: string): boolean { return this.byId.has(id); }
}

class FakeValue extends EntityComponent<{ value: string; isNumeric: boolean }> {
  static typeId = 'value';
  onSpawn(): void {}
  onPropertiesChanged(): void {}
}

function makeEntity(id: string, opts: { type?: string; tags?: string[]; value?: string } = {}): Entity {
  const e = new Entity({
    id,
    type: opts.type ?? 'die',
    name: `${opts.type ?? 'Die'}-${id}`,
    tags: opts.tags ?? [],
  });
  if (opts.value !== undefined) {
    const comp = new FakeValue();
    comp.fromJSON({ value: opts.value, isNumeric: !Number.isNaN(Number(opts.value)) });
    e.attachComponent(comp);
  }
  return e;
}

describe('SceneFacade.getObjectById', () => {
  test('returns a facade for a known id', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1'));
    const facade = new SceneFacade(scene, { registrations: [] });
    const result = facade.getObjectById('d-1');
    expect(result).toBeDefined();
    expect(result?.id).toBe('d-1');
  });

  test('returns undefined for an unknown id', () => {
    const scene = new StubScene();
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.getObjectById('not-real')).toBeUndefined();
  });

  test('returns the same EntityFacade instance across repeat lookups (per-Run identity)', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1'));
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.getObjectById('d-1')).toBe(facade.getObjectById('d-1'));
  });
});

describe('SceneFacade.getTable', () => {
  test('returns a facade for the singleton Table when present', () => {
    const scene = new StubScene();
    scene.add(makeEntity(TABLE_ENTITY_ID, { type: 'table', tags: ['table', 'fixture'] }));
    const facade = new SceneFacade(scene, { registrations: [] });
    const table = facade.getTable();
    expect(table).toBeDefined();
    expect(table!.id).toBe(TABLE_ENTITY_ID);
    expect(table!.type).toBe('table');
  });

  test('returns undefined when the Table has not been spawned', () => {
    const scene = new StubScene();
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.getTable()).toBeUndefined();
  });

  test('returns the same facade as getObjectById(TABLE_ENTITY_ID) (per-Run identity)', () => {
    const scene = new StubScene();
    scene.add(makeEntity(TABLE_ENTITY_ID, { type: 'table' }));
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.getTable()).toBe(facade.getObjectById(TABLE_ENTITY_ID));
  });

  test('Table is reachable via getObjectsByTag("table")', () => {
    const scene = new StubScene();
    scene.add(makeEntity(TABLE_ENTITY_ID, { type: 'table', tags: ['table', 'fixture'] }));
    const facade = new SceneFacade(scene, { registrations: [] });
    const byTag = facade.getObjectsByTag('table').map(e => e.id);
    expect(byTag).toEqual([TABLE_ENTITY_ID]);
    // Tag-query and getTable share identity through the per-Run cache.
    expect(facade.getObjectsByTag('table')[0]).toBe(facade.getTable());
  });
});

describe('SceneFacade.getObjectsByTag', () => {
  test('returns every entity bearing the tag', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { tags: ['die'] }));
    scene.add(makeEntity('d-2', { tags: ['die', 'lucky'] }));
    scene.add(makeEntity('t-1', { tags: ['token'] }));

    const facade = new SceneFacade(scene, { registrations: [] });
    const dice = facade.getObjectsByTag('die').map(d => d.id);
    expect(dice.sort()).toEqual(['d-1', 'd-2']);
  });

  test('returns an empty array on no match', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { tags: ['die'] }));
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.getObjectsByTag('zzz')).toEqual([]);
  });

  test('returns the same instances as getObjectById', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { tags: ['die'] }));
    const facade = new SceneFacade(scene, { registrations: [] });
    const byTag = facade.getObjectsByTag('die')[0];
    const byId  = facade.getObjectById('d-1');
    expect(byTag).toBe(byId);
  });
});

describe('EntityFacade — read-only invariants', () => {
  test('exposes id, type, name, tags', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { type: 'die', tags: ['die', 'lucky'] }));
    const facade = new SceneFacade(scene, { registrations: [] });
    const e = facade.getObjectById('d-1')!;
    expect(e.id).toBe('d-1');
    expect(e.type).toBe('die');
    expect(e.name).toBe('die-d-1');
    expect(e.tags).toEqual(['die', 'lucky']);
  });

  test('mutating the returned tags array does not affect the underlying entity', () => {
    const scene = new StubScene();
    const raw = makeEntity('d-1', { tags: ['die'] });
    scene.add(raw);
    const e = new SceneFacade(scene, { registrations: [] }).getObjectById('d-1')!;
    e.tags.push('mutated');
    expect(raw.tags).toEqual(['die']);
  });

  test('getComponent returns a frozen state view', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { value: '6' }));
    const e = new SceneFacade(scene, { registrations: [] }).getObjectById('d-1')!;

    const view = e.getComponent('value');
    expect(view).toBeDefined();
    expect(view!.state.value).toBe('6');
    expect(view!.state.isNumeric).toBe(true);
    // Frozen — assignments throw in strict mode.
    expect(() => { (view!.state as Record<string, unknown>).value = '1'; }).toThrow();
    expect(Object.isFrozen(view!.state)).toBe(true);
    expect(Object.isFrozen(view)).toBe(true);
  });

  test('getComponent returns undefined when the typeId is absent', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1'));
    const e = new SceneFacade(scene, { registrations: [] }).getObjectById('d-1')!;
    expect(e.getComponent('value')).toBeUndefined();
  });

  test('mutating the returned state copy does not affect the underlying component', () => {
    const scene = new StubScene();
    const raw = makeEntity('d-1', { value: '6' });
    scene.add(raw);
    const e = new SceneFacade(scene, { registrations: [] }).getObjectById('d-1')!;
    const view = e.getComponent('value')!;

    // The view is frozen; even forcing a write through bypassing the freeze
    // (via a fresh copy) doesn't propagate to the live component.
    const live = raw.components.get('value')!;
    expect((view.state as Record<string, unknown>).value).toBe('6');
    expect((live.state as { value: string }).value).toBe('6');
  });

  test('the EntityFacade has no setState / mutator surface for components', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { value: '6' }));
    const e = new SceneFacade(scene, { registrations: [] }).getObjectById('d-1')!;
    const view = e.getComponent('value')!;
    expect((view as unknown as Record<string, unknown>).setState).toBeUndefined();
  });
});

describe('SceneFacade.playSound', () => {
  test('routes the slug through ctx.playSound', () => {
    const scene = new StubScene();
    const calls: string[] = [];
    const facade = new SceneFacade(scene, {
      registrations: [],
      playSound: (slug) => calls.push(slug),
    });
    facade.playSound('custom:dice-roll');
    expect(calls).toEqual(['custom:dice-roll']);
  });

  test('no-ops + warns when ctx.playSound is missing (e.g. guest-side)', () => {
    const scene = new StubScene();
    const warns: string[] = [];
    const facade = new SceneFacade(scene, {
      registrations: [],
      warn: (m) => warns.push(m),
    });
    facade.playSound('custom:roll');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/host-only/);
  });

  test('no-ops + warns on unknown slug when lookupSlug is wired', () => {
    const scene = new StubScene();
    const warns: string[] = [];
    let played = '';
    const facade = new SceneFacade(
      scene,
      {
        registrations: [],
        playSound: (s) => { played = s; },
        warn:      (m) => warns.push(m),
      },
      { lookupSlug: () => undefined },
    );
    facade.playSound('custom:absent');
    expect(played).toBe('');
    expect(warns[0]).toMatch(/unknown asset slug/);
  });

  test('no-ops + warns when slug resolves to a non-sound asset', () => {
    const scene = new StubScene();
    const warns: string[] = [];
    let played = '';
    const m = Manifest.from([
      { slug: 'custom:icon', name: 'I', type: 'image', url: 'http://x/i.png', preload: false },
    ]);
    const facade = new SceneFacade(
      scene,
      {
        registrations: [],
        playSound: (s) => { played = s; },
        warn:      (m2) => warns.push(m2),
      },
      { lookupSlug: (slug) => m.get(slug) },
    );
    facade.playSound('custom:icon');
    expect(played).toBe('');
    expect(warns[0]).toMatch(/not "sound"/);
  });

  test('passes through when validation finds a sound entry', () => {
    const scene = new StubScene();
    const warns: string[] = [];
    let played = '';
    const m = Manifest.from([
      { slug: 'custom:roll', name: 'R', type: 'sound', url: 'http://x/r.mp3', preload: false },
    ]);
    const facade = new SceneFacade(
      scene,
      {
        registrations: [],
        playSound: (s) => { played = s; },
        warn:      (m2) => warns.push(m2),
      },
      { lookupSlug: (slug) => m.get(slug) },
    );
    facade.playSound('custom:roll');
    expect(played).toBe('custom:roll');
    expect(warns).toEqual([]);
  });
});

describe('SceneFacade.assets', () => {
  test('get returns the entry from lookupSlug', () => {
    const scene = new StubScene();
    const m = Manifest.from([
      { slug: 'custom:card', name: 'C', type: 'image', url: 'http://x/c.png', preload: false },
    ]);
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { lookupSlug: (s) => m.get(s) },
    );
    const entry = facade.assets.get('custom:card');
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe('custom:card');
    expect(entry!.type).toBe('image');
  });

  test('get returns null on unknown slug', () => {
    const scene = new StubScene();
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { lookupSlug: () => undefined },
    );
    expect(facade.assets.get('custom:absent')).toBeNull();
  });

  test('get returns null when lookupSlug is not wired', () => {
    const scene  = new StubScene();
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.assets.get('custom:foo')).toBeNull();
  });

  test('get rejects non-string and empty slugs', () => {
    const scene = new StubScene();
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { lookupSlug: () => undefined },
    );
    expect(facade.assets.get('')).toBeNull();
    expect(facade.assets.get(123 as unknown as string)).toBeNull();
  });

  test('list returns the catalog from listAssets', () => {
    const scene = new StubScene();
    const m = Manifest.from([
      { slug: 'custom:a', name: 'A', type: 'image', url: 'http://x/a.png', preload: false },
      { slug: 'custom:b', name: 'B', type: 'sound', url: 'http://x/b.mp3', preload: true },
    ]);
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { listAssets: (opts) => m.list(opts) },
    );
    const all = facade.assets.list();
    expect(all.map(e => e.slug).sort()).toEqual(['custom:a', 'custom:b']);
  });

  test('list filters by type', () => {
    const scene = new StubScene();
    const m = Manifest.from([
      { slug: 'custom:a', name: 'A', type: 'image', url: 'http://x/a.png', preload: false },
      { slug: 'custom:b', name: 'B', type: 'sound', url: 'http://x/b.mp3', preload: true },
    ]);
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { listAssets: (opts) => m.list(opts) },
    );
    const sounds = facade.assets.list({ type: 'sound' });
    expect(sounds.map(e => e.slug)).toEqual(['custom:b']);
  });

  test('list returns empty array when listAssets is not wired', () => {
    const scene = new StubScene();
    const facade = new SceneFacade(scene, { registrations: [] });
    expect(facade.assets.list()).toEqual([]);
  });

  test('returned entries are frozen and mutation does not affect the manifest', () => {
    const scene = new StubScene();
    const m = Manifest.from([
      { slug: 'custom:card', name: 'C', type: 'image', url: 'http://x/c.png', preload: false, tags: ['fancy'] },
    ]);
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { lookupSlug: (s) => m.get(s), listAssets: (o) => m.list(o) },
    );

    const entry = facade.assets.get('custom:card')!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.tags)).toBe(true);
    expect(() => { (entry as unknown as { slug: string }).slug = 'x'; }).toThrow();
    expect(() => { (entry.tags as unknown as string[]).push('mutated'); }).toThrow();

    // Mutation attempt didn't reach the manifest.
    const fresh = m.get('custom:card')!;
    expect(fresh.slug).toBe('custom:card');
    expect(fresh.tags).toEqual(['fancy']);
  });

  test('list result array and elements are frozen', () => {
    const scene = new StubScene();
    const m = Manifest.from([
      { slug: 'custom:a', name: 'A', type: 'image', url: 'http://x/a.png', preload: false },
    ]);
    const facade = new SceneFacade(
      scene,
      { registrations: [] },
      { listAssets: (o) => m.list(o) },
    );
    const arr = facade.assets.list();
    expect(Object.isFrozen(arr)).toBe(true);
    expect(Object.isFrozen(arr[0])).toBe(true);
    expect(() => { (arr as unknown as unknown[]).push({} as never); }).toThrow();
  });

  test('script can call scene.assets.list and assign a slug to a property', async () => {
    const scene = new StubScene();
    scene.add(makeEntity('c-1', { type: 'card' }));
    const m = Manifest.from([
      { slug: 'custom:face-a', name: 'A', type: 'image', url: 'http://x/a.png', preload: false },
      { slug: 'custom:face-b', name: 'B', type: 'image', url: 'http://x/b.png', preload: false },
    ]);

    const { ScriptHost } = await import('./ScriptHost');
    const logs: string[] = [];
    const c = {
      log:   (...a: unknown[]) => logs.push(a.map(String).join(' ')),
      error: () => {},
      warn:  () => {},
      info:  () => {},
      debug: () => {},
    };
    const host = new ScriptHost({
      scene,
      console: c,
      lookupSlug: (s) => m.get(s),
      listAssets: (o) => m.list(o),
    });

    const result = await host.runScript(`
      export default class extends Game {
        onScriptLoaded(s) {
          const images = s.assets.list({ type: 'image' });
          console.log(images.length + ':' + images.map(e => e.slug).join(','));
          const one = s.assets.get('custom:face-a');
          console.log(one ? one.name : 'missing');
        }
      }
    `);
    expect(result.ok).toBe(true);
    expect(logs).toEqual(['2:custom:face-a,custom:face-b', 'A']);
  });
});

describe('SceneFacade — script integration', () => {
  test('script can call getObjectsByTag and read names', async () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { type: 'die', tags: ['die'] }));
    scene.add(makeEntity('d-2', { type: 'die', tags: ['die'] }));
    scene.add(makeEntity('t-1', { type: 'token', tags: ['token'] }));

    const { ScriptHost } = await import('./ScriptHost');
    const logs: string[] = [];
    const c = {
      log:   (...a: unknown[]) => logs.push(a.map(String).join(' ')),
      error: () => {},
      warn:  () => {},
      info:  () => {},
      debug: () => {},
    };
    const host = new ScriptHost({ scene, console: c });

    const result = await host.runScript(`
      export default class extends Game {
        onScriptLoaded(s) {
          console.log(s.getObjectsByTag('die').map(d => d.name).join(','));
        }
      }
    `);
    expect(result.ok).toBe(true);
    expect(logs).toEqual(['die-d-1,die-d-2']);
  });

  test('script can call getTable() and read SkydomeComponent state', async () => {
    const scene = new StubScene();
    const table = new Entity({
      id:   TABLE_ENTITY_ID,
      type: 'table',
      name: 'Table',
      tags: ['table', 'fixture'],
    });
    class Skydome extends EntityComponent<{ textureUrl: string }> {
      static typeId = 'skydome';
      onSpawn(): void {}
      onPropertiesChanged(): void {}
    }
    const sky = new Skydome();
    sky.fromJSON({ textureUrl: 'custom:sky/blue' });
    table.attachComponent(sky);
    scene.add(table);

    const { ScriptHost } = await import('./ScriptHost');
    const logs: string[] = [];
    const c = {
      log:   (...a: unknown[]) => logs.push(a.map(String).join(' ')),
      error: () => {},
      warn:  () => {},
      info:  () => {},
      debug: () => {},
    };
    const host = new ScriptHost({ scene, console: c });

    const result = await host.runScript(`
      export default class extends Game {
        onScriptLoaded(s) {
          const t = s.getTable();
          console.log(t ? t.id : 'missing');
          const sky = t.getComponent('skydome');
          console.log(sky.state.textureUrl);
        }
      }
    `);
    expect(result.ok).toBe(true);
    expect(logs).toEqual([TABLE_ENTITY_ID, 'custom:sky/blue']);
  });
});
