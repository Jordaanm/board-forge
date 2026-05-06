// Per-entity event bus owned inline by `Entity`. Components dispatch domain
// events (e.g. `ValueComponent` fires `value-changed` when its value
// settles); user scripts subscribe via `EntityFacade.addEventListener`.
//
// Listener exceptions are isolated — one throwing listener does not abort
// the rest of the same dispatch. The error is forwarded to a pluggable
// reporter (defaults to `console.error`); structured routing into the
// script error log lands in #7.

export type Listener<T = unknown> = (payload: T) => void;
export type ErrorReporter = (event: string, error: unknown) => void;

const defaultReporter: ErrorReporter = (event, error) => {
  // eslint-disable-next-line no-console
  console.error(`[entity-event] listener for ${event} threw:`, error);
};

export class EntityEventBus {
  // event name → listener[]. Allocated lazily so entities with no
  // subscribers don't pay the Map cost.
  private listeners: Map<string, Listener[]> | null = null;
  private reporter: ErrorReporter;

  constructor(reporter: ErrorReporter = defaultReporter) {
    this.reporter = reporter;
  }

  addListener(event: string, cb: Listener): void {
    if (!this.listeners) this.listeners = new Map();
    const arr = this.listeners.get(event);
    if (arr) arr.push(cb);
    else this.listeners.set(event, [cb]);
  }

  // Removes only the supplied callback. No-op if the callback was never
  // registered or the bus has no subscribers.
  removeListener(event: string, cb: Listener): void {
    const arr = this.listeners?.get(event);
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i < 0) return;
    arr.splice(i, 1);
    if (arr.length === 0) this.listeners!.delete(event);
  }

  // Fanout. Iterates a snapshot so removeListener calls during dispatch
  // don't skip queued listeners. Exceptions are caught per-listener.
  dispatch<T = unknown>(event: string, payload: T): void {
    const arr = this.listeners?.get(event);
    if (!arr || arr.length === 0) return;
    const snapshot = [...arr];
    for (const cb of snapshot) {
      try {
        (cb as Listener<T>)(payload);
      } catch (e) {
        this.reporter(event, e);
      }
    }
  }

  // Test seam — also used by ScriptHost teardown to wipe everything when
  // an entity vanishes mid-Run (rare; full teardown happens via the
  // per-Run registration set, not this method).
  clear(): void {
    this.listeners = null;
  }
}
