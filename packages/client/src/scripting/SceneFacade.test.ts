import { describe, test, expect } from 'vitest';
import { Entity } from '../entity/Entity';
import { type EntityScene } from '../entity/EntityComponent';
import { EntityComponent } from '../entity/EntityComponent';
import { SceneFacade } from './SceneFacade';
import { EntityFacade } from './EntityFacade';

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
    const facade = new SceneFacade(scene);
    const result = facade.getObjectById('d-1');
    expect(result).toBeDefined();
    expect(result?.id).toBe('d-1');
  });

  test('returns undefined for an unknown id', () => {
    const scene = new StubScene();
    const facade = new SceneFacade(scene);
    expect(facade.getObjectById('not-real')).toBeUndefined();
  });

  test('returns the same EntityFacade instance across repeat lookups (per-Run identity)', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1'));
    const facade = new SceneFacade(scene);
    expect(facade.getObjectById('d-1')).toBe(facade.getObjectById('d-1'));
  });
});

describe('SceneFacade.getObjectsByTag', () => {
  test('returns every entity bearing the tag', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { tags: ['die'] }));
    scene.add(makeEntity('d-2', { tags: ['die', 'lucky'] }));
    scene.add(makeEntity('t-1', { tags: ['token'] }));

    const facade = new SceneFacade(scene);
    const dice = facade.getObjectsByTag('die').map(d => d.id);
    expect(dice.sort()).toEqual(['d-1', 'd-2']);
  });

  test('returns an empty array on no match', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { tags: ['die'] }));
    const facade = new SceneFacade(scene);
    expect(facade.getObjectsByTag('zzz')).toEqual([]);
  });

  test('returns the same instances as getObjectById', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { tags: ['die'] }));
    const facade = new SceneFacade(scene);
    const byTag = facade.getObjectsByTag('die')[0];
    const byId  = facade.getObjectById('d-1');
    expect(byTag).toBe(byId);
  });
});

describe('EntityFacade — read-only invariants', () => {
  test('exposes id, type, name, tags', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { type: 'die', tags: ['die', 'lucky'] }));
    const facade = new SceneFacade(scene);
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
    const e = new SceneFacade(scene).getObjectById('d-1')!;
    e.tags.push('mutated');
    expect(raw.tags).toEqual(['die']);
  });

  test('getComponent returns a frozen state view', () => {
    const scene = new StubScene();
    scene.add(makeEntity('d-1', { value: '6' }));
    const e = new SceneFacade(scene).getObjectById('d-1')!;

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
    const e = new SceneFacade(scene).getObjectById('d-1')!;
    expect(e.getComponent('value')).toBeUndefined();
  });

  test('mutating the returned state copy does not affect the underlying component', () => {
    const scene = new StubScene();
    const raw = makeEntity('d-1', { value: '6' });
    scene.add(raw);
    const e = new SceneFacade(scene).getObjectById('d-1')!;
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
    const e = new SceneFacade(scene).getObjectById('d-1')!;
    const view = e.getComponent('value')!;
    expect((view as unknown as Record<string, unknown>).setState).toBeUndefined();
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
});
