import { describe, test, expect, vi } from 'vitest';
import { Entity } from '../entity/Entity';
import { type EntityScene } from '../entity/EntityComponent';
import { ValueComponent } from '../entity/components/ValueComponent';
import { ScriptHost } from './ScriptHost';

class StubScene implements EntityScene {
  private byId = new Map<string, Entity>();
  add(e: Entity): void { this.byId.set(e.id, e); }
  all(): Entity[] { return [...this.byId.values()]; }
  getEntity(id: string): Entity | undefined { return this.byId.get(id); }
  has(id: string): boolean { return this.byId.has(id); }
}

function makeDie(id: string, value = '1'): Entity {
  const e = new Entity({ id, type: 'die', name: `Die-${id}`, tags: ['die'] });
  const c = new ValueComponent();
  c.fromJSON({ value, isNumeric: true });
  e.attachComponent(c);
  return e;
}

interface RecordingConsole {
  log:   (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
  warn:  (...a: unknown[]) => void;
  info:  (...a: unknown[]) => void;
  debug: (...a: unknown[]) => void;
  logs:  string[];
  errors: unknown[][];
}

function recordingConsole(): RecordingConsole {
  const logs: string[] = [];
  const errors: unknown[][] = [];
  const noop = () => {};
  return {
    log:   (...args) => logs.push(args.map(String).join(' ')),
    error: (...args) => errors.push(args),
    warn:  noop,
    info:  noop,
    debug: noop,
    logs,
    errors,
  };
}

const POC_SOURCE = `
  export default class extends Game {
    onScriptLoaded(scene) {
      scene.getObjectsByTag('die').forEach(d =>
        d.addEventListener('value-changed', e => console.log(d.name, e.value))
      );
    }
  }
`;

describe('ScriptHost listener registry — PoC scenario (#5)', () => {
  test('script subscribes; settling a die emits one log with the new value', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    const result = await host.runScript(POC_SOURCE);
    expect(result.ok).toBe(true);

    // Before settle: nothing logged from listeners (only the script's setup).
    expect(c.logs).toEqual([]);

    // Simulate the die settling on a new face.
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
    expect(c.logs).toEqual(['Die-d-1 6']);

    // Setting the same value again is silent (per ValueComponent contract).
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
    expect(c.logs).toEqual(['Die-d-1 6']);

    // Settling on a different face emits another log.
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '4', isNumeric: true });
    expect(c.logs).toEqual(['Die-d-1 6', 'Die-d-1 4']);
  });

  test('after a re-Run the previous listener does not fire; the new listener does', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    await host.runScript(POC_SOURCE);
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
    expect(c.logs).toEqual(['Die-d-1 6']);
    c.logs.length = 0;

    // Re-Run with a different log prefix so we can tell which listener fired.
    await host.runScript(`
      export default class extends Game {
        onScriptLoaded(scene) {
          scene.getObjectsByTag('die').forEach(d =>
            d.addEventListener('value-changed', e => console.log('NEW', d.name, e.value))
          );
        }
      }
    `);
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '3', isNumeric: true });
    expect(c.logs).toEqual(['NEW Die-d-1 3']);
  });

  test('removeEventListener through the facade removes only the targeted callback', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    await host.runScript(`
      export default class extends Game {
        onScriptLoaded(scene) {
          const d = scene.getObjectById('d-1');
          const a = e => console.log('A', e.value);
          const b = e => console.log('B', e.value);
          d.addEventListener('value-changed', a);
          d.addEventListener('value-changed', b);
          d.removeEventListener('value-changed', a);
        }
      }
    `);
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '5', isNumeric: true });
    expect(c.logs).toEqual(['B 5']);
  });

  test('compile failure on re-Run preserves the previous Runs listeners', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    await host.runScript(POC_SOURCE);
    const failed = await host.runScript('this is not valid ts !!!');
    expect(failed.ok).toBe(false);

    // Previous listener still fires.
    scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
    expect(c.logs).toEqual(['Die-d-1 6']);
  });

  test('listener exception is isolated and reported via console.error', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });
    // Listener errors land on the global console (issue #7 routes them to a
    // structured panel log; for #5 console.error is acceptable).
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await host.runScript(`
        export default class extends Game {
          onScriptLoaded(scene) {
            const d = scene.getObjectById('d-1');
            d.addEventListener('value-changed', () => { throw new Error('boom'); });
            d.addEventListener('value-changed', e => console.log('still-ran', e.value));
          }
        }
      `);
      scene.getEntity('d-1')!.getComponent(ValueComponent)!.setState({ value: '6', isNumeric: true });
      expect(c.logs).toEqual(['still-ran 6']);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('EntityFacade.setData / getData / deleteData (#6)', () => {
  test('increments via setData/getData survive across multiple Runs', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    const incrementScript = `
      export default class extends Game {
        onScriptLoaded(s) {
          const d = s.getObjectById('d-1');
          const cur = Number(d.getData('score') ?? '0');
          d.setData('score', String(cur + 1));
          console.log(d.getData('score'));
        }
      }
    `;

    await host.runScript(incrementScript);
    await host.runScript(incrementScript);
    await host.runScript(incrementScript);
    expect(c.logs).toEqual(['1', '2', '3']);
  });

  test('deleteData → getData returns undefined', async () => {
    const scene = new StubScene();
    scene.add(makeDie('d-1'));
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    await host.runScript(`
      export default class extends Game {
        onScriptLoaded(s) {
          const d = s.getObjectById('d-1');
          d.setData('k', 'v');
          d.deleteData('k');
          console.log(String(d.getData('k')));
        }
      }
    `);
    expect(c.logs).toEqual(['undefined']);
  });
});

describe('EntityFacade.setValue (#5)', () => {
  test('updates the underlying ValueComponent state and dispatches value-changed', async () => {
    const scene = new StubScene();
    const die = makeDie('d-1', '1');
    scene.add(die);
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    let observed: { value: string } | null = null;
    die.addEventListener('value-changed', (e: unknown) => { observed = e as { value: string }; });

    await host.runScript(`
      export default class extends Game {
        onScriptLoaded(scene) {
          scene.getObjectById('d-1').setValue('6');
        }
      }
    `);

    expect(die.getComponent(ValueComponent)!.state.value).toBe('6');
    expect(observed).toEqual({ value: '6', isNumeric: true });
  });

  test('setValue with a non-numeric string flips isNumeric to false', async () => {
    const scene = new StubScene();
    const die = makeDie('d-1', '1');
    scene.add(die);
    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });

    await host.runScript(`
      export default class extends Game {
        onScriptLoaded(scene) {
          scene.getObjectById('d-1').setValue('crit');
        }
      }
    `);

    expect(die.getComponent(ValueComponent)!.state.value).toBe('crit');
    expect(die.getComponent(ValueComponent)!.state.isNumeric).toBe(false);
  });

  test('setValue routes through setState — patch is enqueued onto the host replicator', async () => {
    const scene = new StubScene();
    const die = makeDie('d-1', '1');
    scene.add(die);

    const enqueued: Array<{ entityId: string; partial: Record<string, unknown> }> = [];
    die.getComponent(ValueComponent)!.world = {
      enqueueComponentPatch: (p) => enqueued.push({ entityId: p.entityId, partial: p.partial }),
      enqueueEntityPatch:    () => {},
    };

    const c = recordingConsole();
    const host = new ScriptHost({ scene, console: c });
    await host.runScript(`
      export default class extends Game {
        onScriptLoaded(scene) {
          scene.getObjectById('d-1').setValue('6');
        }
      }
    `);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].entityId).toBe('d-1');
    expect(enqueued[0].partial).toMatchObject({ value: '6', isNumeric: true });
  });
});
