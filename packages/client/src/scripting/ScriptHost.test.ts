import { describe, test, expect } from 'vitest';
import { ScriptHost } from './ScriptHost';

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

const BOTH_HOOKS_SOURCE = `
  export default class extends Game {
    onSceneInitialised() { console.log('init'); }
    onScriptLoaded()     { console.log('load'); }
  }
`;

describe('ScriptHost.runScript', () => {
  test('end-to-end pipeline logs from inside the sandbox', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });
    const result = await host.runScript(`
      export default class extends Game {
        onScriptLoaded() { console.log('hi'); }
      }
    `);
    expect(result.ok).toBe(true);
    expect(c.logs).toContain('hi');
  });

  test('hooks not overridden default to no-op via the empty Game base', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });
    const result = await host.runScript(`
      export default class extends Game {}
    `);
    expect(result.ok).toBe(true);
    expect(c.errors).toEqual([]);
  });

  test('surfaces a TS diagnostic for a syntactically broken source', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });
    const result = await host.runScript(`
      export default class extends Game {
        onScriptLoaded() { console.log( }
      }
    `);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  test('exception from a hook is caught — the run still returns ok', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });
    const result = await host.runScript(`
      export default class extends Game {
        onScriptLoaded() { throw new Error('boom'); }
      }
    `);
    expect(result.ok).toBe(true);
    expect(c.errors.length).toBeGreaterThan(0);
  });
});

describe('ScriptHost — initialised flag (#3)', () => {
  test('fresh room: first Run fires both hooks, flips initialised to true', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    expect(host.getScriptState().initialised).toBe(false);
    const result = await host.runScript(BOTH_HOOKS_SOURCE);
    expect(result.ok).toBe(true);

    expect(c.logs).toEqual(['init', 'load']);
    expect(host.getScriptState().initialised).toBe(true);
  });

  test('re-Run fires only onScriptLoaded — onSceneInitialised does not re-fire', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    await host.runScript(BOTH_HOOKS_SOURCE);
    c.logs.length = 0;

    const result = await host.runScript(BOTH_HOOKS_SOURCE);
    expect(result.ok).toBe(true);
    expect(c.logs).toEqual(['load']);
    expect(host.getScriptState().initialised).toBe(true);
  });

  test('exception in onSceneInitialised does not abort onScriptLoaded', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });
    const result = await host.runScript(`
      export default class extends Game {
        onSceneInitialised() { throw new Error('init-boom'); }
        onScriptLoaded()     { console.log('still-ran'); }
      }
    `);
    expect(result.ok).toBe(true);
    expect(c.logs).toContain('still-ran');
    expect(c.errors.length).toBeGreaterThan(0);
    // Even though init threw, the flag flips — the slot's purpose is to
    // gate the hook from re-firing on next Run, regardless of outcome.
    expect(host.getScriptState().initialised).toBe(true);
  });

  test('compile failure on re-Run leaves previous state untouched', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    const ok = await host.runScript(BOTH_HOOKS_SOURCE);
    expect(ok.ok).toBe(true);
    const stateAfterFirst = host.getScriptState();

    const fail = await host.runScript(`export default class extends Game { onScriptLoaded() { console.log( }`);
    expect(fail.ok).toBe(false);

    // initialised flag and source slot unchanged.
    expect(host.getScriptState()).toEqual(stateAfterFirst);
  });
});

describe('ScriptHost.loadScript — save-file load auto-Run (#3)', () => {
  test('loaded state with initialised:false fires both hooks', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    const result = await host.loadScript({ source: BOTH_HOOKS_SOURCE, initialised: false });
    expect(result.ok).toBe(true);
    expect(c.logs).toEqual(['init', 'load']);
    expect(host.getScriptState().initialised).toBe(true);
    expect(host.getScriptState().source).toBe(BOTH_HOOKS_SOURCE);
  });

  test('loaded state with initialised:true fires only onScriptLoaded', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    const result = await host.loadScript({ source: BOTH_HOOKS_SOURCE, initialised: true });
    expect(result.ok).toBe(true);
    expect(c.logs).toEqual(['load']);
    expect(host.getScriptState().initialised).toBe(true);
  });

  test('loaded state with empty source is a no-op', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    const result = await host.loadScript({ source: '', initialised: false });
    expect(result.ok).toBe(true);
    expect(c.logs).toEqual([]);
    // State slot still updated even though no source ran.
    expect(host.getScriptState()).toEqual({ source: '', initialised: false });
  });

  test('after a save-load with initialised:false then a manual Run, init only fires once', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    await host.loadScript({ source: BOTH_HOOKS_SOURCE, initialised: false });
    c.logs.length = 0;

    await host.runScript(BOTH_HOOKS_SOURCE);
    expect(c.logs).toEqual(['load']);
  });
});

describe('ScriptHost.setSource (#3)', () => {
  test('does not touch initialised', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });

    await host.runScript(BOTH_HOOKS_SOURCE);
    expect(host.getScriptState().initialised).toBe(true);

    host.setSource('new draft');
    expect(host.getScriptState().source).toBe('new draft');
    expect(host.getScriptState().initialised).toBe(true);
  });

  test('does not run the script', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({ console: c });
    host.setSource(BOTH_HOOKS_SOURCE);
    expect(c.logs).toEqual([]);
  });
});
