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
