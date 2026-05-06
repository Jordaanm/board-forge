// Side-effect module that installs SES (Compartment + lockdown globals) and,
// in prod builds only, hardens the realm by calling `lockdown()` once.
//
// MUST be imported as the very first line of the client entrypoint so the
// realm is hardened before React, THREE, cannon-es, etc. construct any
// prototype objects that lockdown would later try to freeze. Importing 'ses'
// alone is a side-effect import — it installs the `Compartment` global and
// the `lockdown` function but does not freeze intrinsics.
//
// Why prod-only:
//   - HMR depends on Vite mutating module exports at runtime; that conflicts
//     with frozen intrinsics in dev.
//   - Devtools also walks prototype objects and benefits from leaving them
//     mutable.
//   - v1 trusts host-authored scripts (PRD § Sandboxing). Lockdown's full
//     payoff lands when scripts become shareable.
//
// Why `errorTaming: 'unsafe'`: SES's default error tamer redacts unknown
// strings from `.message` (treating them as sensitive). For a tabletop app
// trusted-host model, retaining full error messages is more useful than the
// confidentiality guarantee, especially because errors funnel into the
// script panel's runtime error log.

import 'ses';

declare const lockdown: ((opts?: Record<string, unknown>) => void) | undefined;

// import.meta.env is provided by Vite. We can't statically destructure here
// because tests run under vitest (Node), where `import.meta.env.PROD` is
// undefined and falsy — exactly the dev behaviour we want.
const isProd = (() => {
  try {
    return Boolean((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD);
  } catch {
    return false;
  }
})();

if (isProd && typeof lockdown === 'function') {
  lockdown({
    errorTaming: 'unsafe',
  });
}
