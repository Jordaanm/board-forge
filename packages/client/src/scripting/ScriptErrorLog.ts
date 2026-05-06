// Bounded ring buffer of script runtime errors. Subscribers (the script
// panel) re-render on push and clear. ScriptHost funnels every caught hook
// error and every caught listener error into this log. Compile errors
// render inline beneath the textarea — they do NOT enter this log.

export interface ScriptErrorEntry {
  // ms since epoch — lets the panel render relative or absolute time.
  timestamp: number;
  // Hook or event source label, e.g. `onScriptLoaded`, `event:value-changed`.
  source:    string;
  // First line of the error's stack (or the message if no stack).
  firstLine: string;
}

const DEFAULT_CAP = 10;

export class ScriptErrorLog {
  private readonly cap: number;
  private entries: ScriptErrorEntry[] = [];
  private subscribers: Array<() => void> = [];

  constructor(cap: number = DEFAULT_CAP) {
    this.cap = Math.max(1, cap);
  }

  push(source: string, error: unknown): ScriptErrorEntry {
    const entry: ScriptErrorEntry = {
      timestamp: Date.now(),
      source,
      firstLine: firstStackLine(error),
    };
    this.entries.push(entry);
    if (this.entries.length > this.cap) {
      // Drop-oldest, preserve insertion order.
      this.entries.splice(0, this.entries.length - this.cap);
    }
    this.notify();
    return entry;
  }

  clear(): void {
    if (this.entries.length === 0) {
      // Still notify so an idempotent Clear click produces a render —
      // matches the AC ("Subscribers are notified on … clear"). Listeners
      // can decide to short-circuit on identical state if needed.
    }
    this.entries = [];
    this.notify();
  }

  // Snapshot copy so subscribers can safely diff array references.
  list(): ScriptErrorEntry[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }

  // Returns an unsubscribe function. Subscribers are invoked synchronously
  // after each push and clear.
  subscribe(fn: () => void): () => void {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== fn);
    };
  }

  private notify(): void {
    for (const s of this.subscribers) {
      try {
        s();
      } catch {
        // Subscriber misbehaviour must not break the log itself.
      }
    }
  }
}

function firstStackLine(error: unknown): string {
  if (error instanceof Error) {
    if (error.stack) {
      const lines = error.stack.split('\n');
      // V8 stacks lead with "Error: msg"; the actual frame is the second
      // line. Fallback to the message when the stack is single-line.
      const frame = lines[1]?.trim();
      if (frame) return `${error.message} — ${frame}`;
      return error.message;
    }
    return error.message;
  }
  return String(error);
}
