import { describe, test, expect } from 'vitest';
import { compileTypescript } from './Compiler';

describe('compileTypescript', () => {
  test('strips types from valid TypeScript', async () => {
    const result = await compileTypescript(`
      const x: number = 42;
      export const y: string = String(x);
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.js).toContain('const x = 42');
      expect(result.js).not.toContain(': number');
      expect(result.js).not.toContain(': string');
    }
  });

  test('compiles a Game default export', async () => {
    const result = await compileTypescript(`
      export default class extends Game {
        onScriptLoaded() { console.log('hi'); }
      }
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // CommonJS emission so the Sandbox can evaluate the script and read the
      // default off `exports`.
      expect(result.js).toContain('exports.default');
      expect(result.js).toContain('extends Game');
    }
  });

  test('reports a diagnostic for syntactically broken source', async () => {
    const result = await compileTypescript(`
      export default class extends Game {
        onScriptLoaded() { console.log( }   // unterminated call
      }
    `);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
