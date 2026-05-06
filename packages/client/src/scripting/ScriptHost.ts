// Orchestrates compile → sandbox → instantiate → run-hooks for the host's
// authored script. Composed into `World` only on host construction.
//
// First-iteration surface is intentionally tiny: `runScript(source)` does
// the whole pipeline and surfaces the compile error (if any). Idempotent
// re-Runs, listener teardown, save-load auto-Run, scene facade, error log
// all land in later issues (#3, #5, #7).

import { compileTypescript } from './Compiler';
import { loadModule } from './Sandbox';
import { Game } from './Game';

export interface ScriptHostOptions {
  // Injected so tests can substitute a recording console.
  console?: Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug'>;
}

export type RunResult =
  | { ok: true }
  | { ok: false; error: string };

export class ScriptHost {
  private readonly console_: ScriptHostOptions['console'];

  constructor(opts: ScriptHostOptions = {}) {
    this.console_ = opts.console ?? console;
  }

  async runScript(source: string): Promise<RunResult> {
    const compiled = await compileTypescript(source);
    if (!compiled.ok) return { ok: false, error: compiled.error };

    let ns;
    try {
      ns = loadModule(compiled.js, {
        Game,
        scene:   {},
        console: this.console_,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.console_?.error('[script] module load failed:', e);
      return { ok: false, error: msg };
    }

    const Cls = ns.default;
    if (typeof Cls !== 'function') {
      const msg = 'Script must `export default` a class extending Game.';
      this.console_?.error('[script]', msg);
      return { ok: false, error: msg };
    }

    let instance: Game;
    try {
      instance = new (Cls as new () => Game)();
    } catch (e) {
      this.console_?.error('[script] constructor threw:', e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const scene = {};
    this.invokeHook(instance, 'onSceneInitialised', scene);
    this.invokeHook(instance, 'onScriptLoaded', scene);

    return { ok: true };
  }

  private invokeHook(instance: Game, name: 'onSceneInitialised' | 'onScriptLoaded', scene: unknown): void {
    const fn = (instance as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') return;
    try {
      (fn as (s: unknown) => void).call(instance, scene);
    } catch (e) {
      this.console_?.error(`[script] ${name} threw:`, e);
    }
  }
}
