// One-time script console support. The host's Console panel lets the host
// type ad-hoc TypeScript and run it once against the live `scene` and the
// active `game` instance — used for setup tweaks, debugging, and quick
// inspections. The flow is wired by `ScriptHost.runOneShot`.

export type LogLevel = 'log' | 'error' | 'warn' | 'info' | 'debug';

export interface LogLine {
  level: LogLevel;
  // Pre-formatted string for direct rendering. Multiple args are joined
  // with a space — same shape browsers use for `console.log(a, b, c)`.
  text:  string;
}

export interface CapturingConsole {
  console: Pick<Console, LogLevel>;
  logs:    LogLine[];
}

// Builds a `console`-shaped object that records every call into `logs`
// while ALSO forwarding to the underlying real console — so the host can
// inspect output in the panel and still see entries in devtools without
// switching contexts.
export function makeCapturingConsole(passthrough?: Pick<Console, LogLevel>): CapturingConsole {
  const logs: LogLine[] = [];
  const capture = (level: LogLevel) => (...args: unknown[]) => {
    logs.push({ level, text: args.map(formatArg).join(' ') });
    passthrough?.[level](...args);
  };
  return {
    logs,
    console: {
      log:   capture('log'),
      error: capture('error'),
      warn:  capture('warn'),
      info:  capture('info'),
      debug: capture('debug'),
    },
  };
}

// Wraps the user's input as a CJS module whose default export is the
// promise returned by an async IIFE around the user's source. The host
// awaits it to surface the final value (use `return X` to display one)
// and to ensure thrown errors propagate as rejections we can format.
export function wrapOneShotSource(userSource: string): string {
  return `module.exports = (async () => {\n${userSource}\n})();`;
}

// JSON-ish formatter for log args + return values. Errors render with
// their message; functions render as `[Function: name]`; circular objects
// fall back to `[object Object]`. Kept small and dependency-free — the
// console panel renders the resulting string as plain text.
export function formatArg(value: unknown): string {
  if (value === null)        return 'null';
  if (value === undefined)   return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'function') {
    const name = (value as { name?: string }).name || 'anonymous';
    return `[Function: ${name}]`;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value, replacer(), 2);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

// Replacer that detects cycles. JSON.stringify with a replacer is the
// simplest cycle-safe path that still respects the user's toJSON if any.
function replacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value as object)) return '[Circular]';
      seen.add(value as object);
    }
    if (typeof value === 'function') {
      const name = (value as { name?: string }).name || 'anonymous';
      return `[Function: ${name}]`;
    }
    return value;
  };
}
