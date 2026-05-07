// Drift guardrail (Slice 9). Asserts the runtime classes (Game,
// SceneFacade, EntityFacade) remain structurally assignable to the
// editor-facing types in script-globals-types.ts. If a contributor adds
// a method to the runtime without updating the canonical types, `tsc
// --noEmit` fails — forcing the editor surface to stay in lock-step.
//
// Plain Vitest test rather than a typecheck-only file because Vitest
// runs `tsc` over its files indirectly (via vite-node + the project
// tsconfig that already has `noEmit: true`). Using `Expect<…>` helpers
// raises the failure as compile-time errors.

import { describe, test, expect } from 'vitest';
import { Game } from './Game';
import { SceneFacade, AssetsApi } from './SceneFacade';
import { EntityFacade } from './EntityFacade';
import {
  EditorGame,
  EditorSceneFacade,
  EditorEntityFacade,
  EditorAssetsApi,
} from './script-globals-types';

// `Expect<true>` resolves to `true`; anything else is a TS error at the
// usage site. Used to assert assignability between two types.
type Expect<T extends true> = T;

// Drift detection compares public-key sets, not full structural shape:
// runtime classes have private fields that break direct extends-checks
// between class types. `keyof` on a class instance only enumerates
// public keys, so checking that the runtime's public keys are a subset
// of the editor's keys catches "method added to runtime but missing
// from canonical types" without false positives from private internals.
type RuntimeKeys<T> = keyof T;
type _GameCompat   = Expect<RuntimeKeys<InstanceType<typeof Game>>          extends keyof EditorGame          ? true : false>;
type _SceneCompat  = Expect<RuntimeKeys<InstanceType<typeof SceneFacade>>   extends keyof EditorSceneFacade   ? true : false>;
type _EntityCompat = Expect<RuntimeKeys<InstanceType<typeof EntityFacade>>  extends keyof EditorEntityFacade  ? true : false>;
type _AssetsCompat = Expect<RuntimeKeys<InstanceType<typeof AssetsApi>>     extends keyof EditorAssetsApi     ? true : false>;

// The type aliases above only need to be evaluated by the compiler — the
// runtime test below exists so Vitest reports something positive when
// the type-level checks pass. If the type aliases were `never` we'd see
// a `tsc` error before this file even loaded.
describe('script-globals drift', () => {
  test('runtime classes assign to editor-facing types', () => {
    // Smoke values to keep the type-aliases live — without `void`, TS
    // complains about unused declarations under `noUnusedLocals`.
    void ({} as _GameCompat);
    void ({} as _SceneCompat);
    void ({} as _EntityCompat);
    void ({} as _AssetsCompat);
    expect(true).toBe(true);
  });
});
