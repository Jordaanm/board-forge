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

// Prod-build sanity check (issue #8). If lockdown ran successfully, JS
// intrinsics are frozen — we sample `Array.prototype` as the canonical
// indicator. Dev builds skip lockdown deliberately, so the warning only
// fires in prod. Warns at most once per session.
let lockdownChecked = false;
function warnIfProdLockdownMissing(): void {
  if (lockdownChecked) return;
  lockdownChecked = true;
  const isProd = (() => {
    try {
      return Boolean((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD);
    } catch {
      return false;
    }
  })();
  if (!isProd) return;
  if (Object.isFrozen(Array.prototype)) return;
  // eslint-disable-next-line no-console
  console.warn(
    '[scripting] SES lockdown() did not run in this prod build — script ' +
      'isolation is weakened. Verify scripting/bootstrap.ts is the first ' +
      'import in main.tsx.',
  );
}

// Loads CommonJS-shaped `jsSource` inside a fresh Compartment with the given
// globals, then returns the captured `exports` (so callers can read
// `.default`). Throws on parse / evaluation errors.
export function loadModule(
  jsSource: string,
  globals: Record<string, unknown>,
): ModuleNamespace {
  warnIfProdLockdownMissing();

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
