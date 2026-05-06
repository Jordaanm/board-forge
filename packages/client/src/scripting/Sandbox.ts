// Wraps SES `Compartment` (via `evaluate`) so user scripts run with realm-
// scoped host APIs (`window`, `document`, timers, `fetch`, …) stripped. The
// Compiler emits CommonJS-style output, so the script's default export ends
// up on a synthetic `exports` object we read after `evaluate` returns.
//
// Importing 'ses' installs the Compartment global. We do NOT call
// `lockdown()` here — that's the responsibility of the prod bootstrap
// (issue #8). Compartment-default behaviour already hides realm-bound host
// APIs from the script.

import 'ses';

interface CompartmentInstance {
  evaluate(code: string): unknown;
}
type CompartmentCtor = new (options: unknown) => CompartmentInstance;
declare const Compartment: CompartmentCtor;

export interface ModuleNamespace {
  default?: unknown;
  [k: string]: unknown;
}

// Loads CommonJS-shaped `jsSource` inside a fresh Compartment with the given
// globals, then returns the captured `exports` (so callers can read
// `.default`). Throws on parse / evaluation errors.
export function loadModule(
  jsSource: string,
  globals: Record<string, unknown>,
): ModuleNamespace {
  const exportsObj: ModuleNamespace = {};
  const moduleObj  = { exports: exportsObj };

  const compartment = new Compartment({
    __options__: true,
    // Despite the published types saying `Map<string, any>`, the runtime
    // spreads `globals` as a plain object (`{ ...globals }`), so a Map ends
    // up empty. Plain object record matches the actual implementation.
    globals: {
      ...globals,
      exports: exportsObj,
      module:  moduleObj,
    },
  });

  compartment.evaluate(jsSource);
  // CJS authors sometimes reassign `module.exports` wholesale. Honour that.
  return (moduleObj.exports as ModuleNamespace) ?? exportsObj;
}
