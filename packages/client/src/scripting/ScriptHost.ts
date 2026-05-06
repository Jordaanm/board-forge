// Orchestrates compile → sandbox → instantiate → run-hooks for the host's
// authored script. Composed into `World` only on host construction.
//
// `runScript(source)` is the Run flow:
//   1. Compile new source. On failure: leave the previous instance live,
//      surface the diagnostic, do nothing else.
//   2. Tear down the previous Run's listener registrations (no-op until #5).
//   3. Instantiate the new class.
//   4. If `state.initialised === false`: invoke `onSceneInitialised(scene)`,
//      flip the flag to `true`, then `onScriptLoaded(scene)`. Otherwise:
//      `onScriptLoaded(scene)` only. Each hook is wrapped in try/catch
//      individually so an exception in one doesn't abort the rest.
//
// `loadScript({source, initialised})` is the save-file-load entrypoint —
// World invokes it after `replaceScene` populates entities. It overwrites
// the state slot then runs the same flow, so a save authored before the
// first init still fires `onSceneInitialised` exactly once on load.
//
// History undo/redo deliberately routes through `replaceScene` only and
// does NOT re-Run the script: listeners attached against entities that
// survive undo continue to work, and we don't want each undo to fire the
// hooks again.

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

// Persisted per-room script state. `source` is the authored TS the host
// last saved; `initialised` flips to true after `onSceneInitialised` fires
// for the first time on this room.
export interface ScriptState {
  source:      string;
  initialised: boolean;
}

export class ScriptHost {
  private readonly console_: ScriptHostOptions['console'];
  private state_: ScriptState = { source: '', initialised: false };
  // Most recent successfully-instantiated user class. Held so a failed
  // re-Run (compile error) leaves it live — listeners attached against it
  // (issue #5) keep working until a successful Run replaces it.
  private currentInstance: Game | null = null;

  constructor(opts: ScriptHostOptions = {}) {
    this.console_ = opts.console ?? console;
  }

  // Authoritative state slot for save/load. Returns a defensive copy so
  // callers can't mutate the live record.
  getScriptState(): ScriptState {
    return { source: this.state_.source, initialised: this.state_.initialised };
  }

  // Replaces the entire state slot. Used by tests and the save-file-load
  // path before `loadScript` runs the new source. Does not invoke hooks.
  loadScriptState(state: ScriptState): void {
    this.state_ = { source: state.source, initialised: state.initialised };
  }

  // Save Script — writes the textarea source into room state. `initialised`
  // is preserved.
  setSource(source: string): void {
    this.state_ = { source, initialised: this.state_.initialised };
  }

  // Save-file-load entrypoint. Replaces the state slot then runs the same
  // flow as `runScript` so the loaded `initialised` flag governs whether
  // `onSceneInitialised` fires.
  async loadScript(state: ScriptState): Promise<RunResult> {
    this.loadScriptState(state);
    if (!state.source) return { ok: true };
    return this.runScript(state.source);
  }

  async runScript(source: string): Promise<RunResult> {
    const compiled = await compileTypescript(source);
    if (!compiled.ok) {
      // Compile failure: leave the previously-running instance + listeners
      // alive. Surface the diagnostic.
      return { ok: false, error: compiled.error };
    }

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

    // Tear down the previous Run's listener registrations. No-op until #5
    // adds the registry; preserved as a hook so the Run flow stays stable.
    this.teardownPreviousRun();

    let instance: Game;
    try {
      instance = new (Cls as new () => Game)();
    } catch (e) {
      this.console_?.error('[script] constructor threw:', e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // Install the new instance before firing hooks so an exception during
    // a hook still leaves the new instance current (its listeners, once #5
    // lands, will be torn down on the next Run regardless).
    this.currentInstance = instance;

    // Run does NOT persist `source` — Save Script (`setSource`) is the
    // explicit save path. The user might click Run on a draft they don't
    // want saved yet.
    const scene = {};
    if (!this.state_.initialised) {
      this.invokeHook(instance, 'onSceneInitialised', scene);
      this.state_ = { source: this.state_.source, initialised: true };
    }
    this.invokeHook(instance, 'onScriptLoaded', scene);

    return { ok: true };
  }

  // Hook — placeholder until #5 lands a real listener registry. Kept as
  // an explicit step in the Run flow so the order doesn't drift; reads the
  // current instance reference to discipline the lifecycle.
  private teardownPreviousRun(): void {
    if (!this.currentInstance) return;
    // #5 will: iterate the per-Run listener registration set, call
    // removeListener on the underlying buses, clear the set.
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
