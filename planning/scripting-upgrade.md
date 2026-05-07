# Script Editor Upgrade: Modal Redesign + Monaco LSP

## Context

The host-only script editor is a plain `<textarea>` inside a left-anchored `UIPanel`. Hosts authoring TypeScript games against the `Game` / `SceneFacade` / `EntityFacade` API get no syntax highlighting, no autocomplete, no inline type errors. They also edit in a small collapsible side panel that shares vertical space with the rest of the host UI.

This upgrade does two things:

1. **UX redesign**: replace the collapsible side panel with a button-launched modal dialog that takes most of the screen. Adds dirty tracking, close-confirm, unified error log.
2. **Editor upgrade**: swap the textarea for Monaco (same engine as VS Code) configured against a hand-curated `.dts` of the public scripting API — gives syntax highlighting, tab autocomplete on the API surface, hover types, inline type-error squiggles.

Shipped as **two sequential PRs**, with a **throwaway spike branch in between** to validate Monaco's coexistence with SES `lockdown()` in the real production context (Monaco mounted inside the Radix Dialog).

---

## Sequencing

```
main ── PR1 (modal, textarea) ── spike/monaco-ses (throwaway) ── PR2 (Monaco) ── main
```

- **PR1** lands first: pure UX restructuring, no SES risk, no Monaco risk. Faster review, isolates layout/state-machine bugs from language-service complexity.
- **Spike branch** forks from main after PR1 lands. Validates Monaco-in-Dialog under prod `lockdown()`. Never merges. Outcome documented in this file.
- **PR2** swaps the textarea for Monaco, with whatever lockdown adjustments the spike identified.

---

## PR1 — Modal Redesign

### Scope

Move script editing from the left-anchored `UIPanel` to a modal dialog launched from `HostActionBar`. Editor remains a textarea; all the *new* state-machine logic (dirty tracking, close-confirm, unified error log, Ctrl+S/Ctrl+Enter) lands here. PR2 then swaps the textarea for Monaco without touching this state machine.

### Files

- **New**: `packages/client/src/components/ScriptEditorModal.tsx` — Radix Dialog containing the textarea, button row, error log. Replaces the role of the old `ScriptPanel.tsx`.
- **Delete**: `packages/client/src/components/ScriptPanel.tsx` — UIPanel-based collapse panel. Dead code after the modal lands.
- **Modify**: `packages/client/src/components/HostActionBar.tsx` — add an "Edit Script" button that opens the modal. Pattern: same as `HistoryModal` / `LoadSceneModal` / `SpawnObjectModal` — button + modal in one component, dropped into the bar.
- **Modify**: `packages/client/src/pages/Room.tsx` — remove the `<UIPanel anchor="top-left" order={20}><ScriptPanel … /></UIPanel>` mount. Pass `onSave` / `onRun` / `errorLog` / `getSavedScriptSourceRef` through to `HostActionBar` (or directly to `ScriptEditorModal` if cleaner).
- **Modify**: `packages/client/src/scripting/ScriptHost.ts` — when `runScript` returns a compile failure, push the error into `errorLog_` with `source: 'compile'` *and* return `{ ok: false, error }` (callers may still disable Run-result UI). Eliminates the inline error block.
- **Modify**: World wiring (wherever `ScriptHost` is constructed and refs are exposed to `Room.tsx`) — add a `getSavedScriptSourceRef` getter alongside the existing `saveScriptSourceRef` / `runScriptRef` so the modal can read `ScriptHost.getScriptState().source` without mirroring it in React state.

### Modal mechanics

- **Library**: `@radix-ui/react-dialog` (already a dep). Pattern: `Dialog.Root` / `Dialog.Portal` / `Dialog.Overlay` / `Dialog.Content`, with `useAnchorTarget('center')` for portal positioning. Match `HistoryModal.tsx` conventions.
- **Trigger**: button on `HostActionBar`, between History and the Show-All-Zones toggle (or wherever fits the existing flow).
- **Sizing**: `width: 90vw, maxWidth: 1400, height: 88vh`. `box-shadow` and `background` matching existing modals.
- **Layout** (vertical stack inside `Dialog.Content`):
  - Header: title "Script Editor" + Radix close `×` button.
  - Editor region: ~75% of remaining height. Textarea (PR1) / Monaco (PR2). PR1 textarea keeps `resize: vertical`; PR2 swaps to a `resize: vertical` wrapper div with Monaco filling it.
  - Button row: `[Save Script]` `[Run Script]` — fixed height.
  - Error log region: `max-height: 25%`, `overflow-y: auto`. Accepts entries with any `source` value (existing `ScriptErrorEntry.source` field).

### Dirty tracking + close-confirm

- **Baseline source-of-truth**: `ScriptHost.getScriptState().source` (read via `getSavedScriptSourceRef.current()`). Modal does not duplicate baseline state in React.
- **Dirty check**: `scriptSource !== getSavedScriptSourceRef.current()`, computed on close-attempt only (no per-keystroke reactivity needed for this).
- **Close interception**: `<Dialog.Root onOpenChange={(next) => { if (!next && dirty) openConfirm(); else setOpen(next); }}>`.
- **Confirm dialog**: render inline within `Dialog.Content` as a centered overlay div (cheaper than nesting a second Radix Dialog; the parent's focus-trap covers it). Three buttons:
  - **Save & close** → `setSource(scriptSource)`, then close both confirm and modal.
  - **Discard & close** → `setScriptSource(getSavedScriptSourceRef.current())` (revert React state to baseline), then close both.
  - **Cancel** → close confirm, leave modal open.

### Unified error log

- **Three error sources**, all flow into `ScriptErrorLog`:
  - **Compile** (from `ScriptHost.runScript`): `source: 'compile'`. Pushed by `runScript` itself before returning `ok: false`.
  - **Hook throws** (existing): `source: 'onSceneInitialised' | 'onScriptLoaded'` etc.
  - **Listener throws** (existing): `source: 'event:<name>'`.
- **Visual differentiation**: badge styling per source value (e.g. compile = blue badge, runtime = red badge). Latest entry at top.
- **No more inline error block** — the box that currently lives at line 201 of `ScriptPanel.tsx` is removed; compile errors are just log entries.

### Keyboard shortcuts

- **Ctrl+S**: Save Script. Implementation: `onKeyDown` on `Dialog.Content` checks `e.ctrlKey && e.key === 's'` → `e.preventDefault()` (block browser save-page) → call Save handler.
- **Ctrl+Enter**: Run Script. Same handler, different key check.
- **Esc**: closes the modal (Radix default). If dirty, the close interceptor runs → confirm appears.

This handler lives at `Dialog.Content` so it works for both the textarea (PR1) and Monaco (PR2). PR2 will *also* register the bindings via `editor.addCommand` so they fire when the editor has focus and Monaco's own keymap takes precedence — but the Dialog-level handler is the canonical fallback.

### Empty-state seed

When `scriptSource === ''` on modal open, seed the editor with a commented example:

```ts
// Edit and click Run.
//
// export default class extends Game {
//   onScriptLoaded(scene) { console.log('hi') }
// }
```

Seeded value flows through `onChange` → `setScriptSource` → first Save persists it. Hosts who don't want the comment delete it before saving.

### Tests (PR1)

- **State-machine tests** (`packages/client/src/components/ScriptEditorModal.test.tsx`):
  - Open modal with no edits → close → no confirm dialog appears.
  - Open modal → type → close → confirm appears with three buttons.
  - Save & close → `setSource` called with current source, modal closes.
  - Discard & close → `setScriptSource` called with baseline, modal closes.
  - Cancel → modal stays open.
  - Click Run → `onRun` called; on compile failure, `errorLog` gains an entry with `source: 'compile'`.
  - Ctrl+S keydown → Save handler fires.
  - Ctrl+Enter keydown → Run handler fires.
- **Playwright skeleton**: introduce `@playwright/test` to the repo. New `e2e/` dir at root, `playwright.config.ts` with chromium project, `webServer` running `pnpm dev`. One smoke test: open Room as host, click Edit Script, type into modal, Save, close. Verifies the wiring end-to-end.
- Existing scripting backend tests (`ScriptHost.test.ts` etc.) remain green — `runScript` change is additive (push to log + still return error).

### Verification (PR1)

1. `pnpm --filter client dev` → open a room as host → click Edit Script on `HostActionBar`.
2. Modal opens at ~90% screen, textarea editable, dirty=false, Save/Run buttons present, error log empty.
3. Type a character → close-attempt → confirm appears → Cancel → still open.
4. Discard & close → modal closes, scriptSource reverts.
5. Edit + Save & close → modal closes; reopen → source persisted.
6. Click Run on broken syntax → compile error appears in log with `source: 'compile'` badge.
7. Click Run on script that throws in `onScriptLoaded` → runtime error appears in log with appropriate source.
8. Ctrl+S inside modal → Save fires, no browser save-page dialog.
9. Ctrl+Enter inside modal → Run fires.
10. `pnpm --filter client test` → all unit tests pass, including new modal state-machine tests.
11. `pnpm --filter client e2e` (or whatever script name) → Playwright smoke test passes.

---

## Spike Branch — SES + Monaco Compatibility

**Branch name**: `spike/monaco-ses`. Forks from `main` *after* PR1 lands. Never merges.

### Goal

Confirm Monaco mounts and operates cleanly inside the Radix Dialog under prod-mode SES `lockdown()`. The lockdown call (`bootstrap.ts` lines 39-43) freezes JS intrinsics; Monaco runs in the main realm and may mutate prototypes during init.

### What gets built on the spike branch

1. Install `monaco-editor` and `@monaco-editor/react`.
2. Replace the textarea inside `ScriptEditorModal` (just for the spike) with a bare Monaco `<Editor>` instance — `language="typescript"`, `theme="vs-dark"`, no `.dts`, no compiler-options config.
3. Configure `self.MonacoEnvironment.getWorker` to return:
   - `monaco-editor/esm/vs/editor/editor.worker?worker` (base worker)
   - `monaco-editor/esm/vs/language/typescript/ts.worker?worker` (TS language service)
4. `pnpm --filter client build && pnpm --filter client preview`. Open the Room as host. Click Edit Script.

### Acceptance checklist

In the prod preview, verify *all* of these:

1. Editor mounts inside the modal without console errors.
2. Both `ts.worker` and `editor.worker` chunks load (Network tab).
3. Typing characters renders them in the editor.
4. `console.` triggers autocomplete (proves built-in TS lib loaded under lockdown).
5. Type a deliberate type error (e.g. `const x: number = 'foo'`) → red squiggle appears.
6. Edit / undo / redo / close / re-open the modal for ~30s with no exceptions in console.
7. Reload the prod page and repeat 3–6 (catches lockdown-on-second-mount bugs).
8. Modal's focus-trap interacts cleanly with Monaco's keyboard handling (Tab, Shift+Tab inside editor don't break the trap).

### Decision tree

- **All 1–8 pass** → spike succeeds, proceed to PR2 with current `bootstrap.ts` settings.
- **1 or 2 fails (init / workers)** → relax lockdown options in `bootstrap.ts`: add `evalTaming: 'unsafeEval'` and `overrideTaming: 'severe'`. Re-run checklist.
- **After lockdown relaxation, 1 or 2 still fails** → fall back to CodeMirror 6 + `@codemirror/lang-javascript` for syntax highlighting; basic LSP via `@valtown/codemirror-ts`. Revise PR2 plan against CodeMirror.
- **3–8 fails but 1–2 pass** → not a SES problem. Diagnose the specific check (model disposal, focus trap, etc.) before reaching for lockdown changes.

### Output

Result documented as a "Spike Outcome" section appended to this file before PR2 starts. One paragraph: which checks passed, what (if any) lockdown options were added, whether to proceed with Monaco or fall back. The branch itself is then deleted.

### Spike Outcome (2026-05-06)

Bare Monaco mount under prod-mode `lockdown()` initially threw `Cannot assign to read only property 'constructor' of object '[object Object]'` on first mount — exactly the SES intrinsic-frozen failure the spike was designed to catch. Adding `evalTaming: 'unsafeEval'` and `overrideTaming: 'severe'` to the lockdown options in `bootstrap.ts` cleared the failure. With the relaxation in place: editor mounts, both worker chunks load, typing renders, autocomplete on `console.` triggers (proves the TS language service is alive in its worker), edit/undo/close/reopen for ~30s with no exceptions, page reload repeats cleanly. The only residual page-error is Monaco's benign async-cancellation pseudo-error ("Canceled: Canceled") which fires during editor state transitions and is filtered as known noise.

Decision: **proceed with Monaco for PR2** with the lockdown relaxation kept. Compartment-scoped script execution is unaffected by the relaxed taming options — user-script SES isolation is preserved.

---

## PR2 — Monaco Swap

### Scope

Replace the textarea inside `ScriptEditorModal` with a Monaco-based `ScriptEditor` component. Wire up the public-API `.dts` for autocomplete. All modal mechanics (dirty tracking, close-confirm, error log, shortcuts) from PR1 stay unchanged.

### Files

- **New**: `packages/client/src/components/ScriptEditor.tsx` — wraps `@monaco-editor/react`'s `<Editor>`. Lazy-loaded via `React.lazy`.
- **New**: `packages/client/src/scripting/script-globals-types.ts` — canonical TypeScript declarations of the editor-facing API as exported `interface` set. Single source of truth.
- **New**: `packages/client/src/scripting/script-globals.dts` — generated text artifact (no `.ts` suffix; TypeScript ignores it as ambient declarations). Generated from `script-globals-types.ts` via `pnpm gen:script-globals`. Loaded into Monaco via `?raw` import.
- **New**: `packages/client/scripts/gen-script-globals.ts` — codegen script that emits the `.dts` from `script-globals-types.ts`. Run via package.json script.
- **New**: `packages/client/src/scripting/script-globals.test.ts` — structural compatibility test asserting `EntityFacade extends EditorEntityFacade` etc., catching drift at `tsc` time.
- **New**: `packages/client/src/vite-env.d.ts` — declares `*.dts?raw` module so Vite's `?raw` import has TypeScript types.
- **Modify**: `packages/client/src/components/ScriptEditorModal.tsx` — swap textarea for `<Suspense fallback={<LoadingPlaceholder />}><ScriptEditor … /></Suspense>` wrapped in an `ErrorBoundary` whose fallback degrades to a textarea + visible "Editor failed to load" message.
- **Modify**: `packages/client/src/components/HostActionBar.tsx` — add `onMouseEnter` to the Edit Script button that triggers `import('./ScriptEditor')` to preload Monaco's chunk before click.
- **Modify**: `packages/client/package.json` — add `monaco-editor`, `@monaco-editor/react` deps. Add `gen:script-globals` script.

### `script-globals-types.ts` content

Hand-author exported `interface` types covering the editor-facing surface only. Reference (do not import from):
- `packages/client/src/scripting/Game.ts` (the `Game` class)
- `packages/client/src/scripting/SceneFacade.ts` (`getObjectById`, `getObjectsByTag`)
- `packages/client/src/scripting/EntityFacade.ts` (id, type, name, owner, tags, getComponent, addEventListener, removeEventListener, setValue, setData, getData, deleteData)

Internal types (`Entity`, `EntityScene`, `ScriptRunContext`, the underscored fields in `EntityFacade`) stay out.

### `script-globals.dts` content (generated)

Codegen produces a `declare global { … }` block + class/interface declarations the editor needs for autocomplete. Sample shape:

```ts
declare class Game {
  onSceneInitialised(scene: SceneFacade): void;
  onScriptLoaded(scene: SceneFacade): void;
}
declare class SceneFacade {
  getObjectById(id: string): EntityFacade | undefined;
  getObjectsByTag(tag: string): EntityFacade[];
}
declare class EntityFacade { /* … */ }
interface ReadOnlyComponentView { readonly state: Readonly<Record<string, unknown>> }

declare global {
  var scene: SceneFacade;
  var Game: typeof Game;
  var console: Pick<Console, 'log'|'error'|'warn'|'info'|'debug'>;
}
```

Critical: file is **not** `.d.ts`. TypeScript's `tsconfig.json` includes `src/`, so a `.d.ts` would pollute the entire client codebase's ambient namespace (autocomplete `scene` everywhere). The `.dts` extension keeps it as a pure text asset that only Monaco sees, while still being valid TypeScript syntax.

### `ScriptEditor` component

- `<Editor>` props:
  - `language="typescript"`
  - `theme="vs-dark"`
  - `path="user-script.ts"` (stable Monaco URI; library reuses model across mounts so cursor/undo survive collapse-and-reopen)
  - `value={source}` (controlled by parent)
  - `onChange={onChange}`
- One-time module init (runs once on first mount):
  - `monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ target: ScriptTarget.ES2022, module: ModuleKind.CommonJS, isolatedModules: true, strict: false, lib: ['ES2022'], allowNonTsExtensions: true })` — mirrors `Compiler.ts:19-31`, omits DOM lib so scripts can't autocomplete `window`/`document` they don't have at runtime, **`strict: false`** matches the runtime's permissive feel.
  - `monaco.languages.typescript.typescriptDefaults.addExtraLib(dtsContent, 'file:///globals.d.ts')` (URI distinct from the model URI).
- `editor.addCommand` registrations (PR2-specific):
  - Ctrl+S → call Save handler (also handled at Dialog.Content level for redundancy).
  - Ctrl+Enter → call Run handler.
- Wrapped in a `resize: vertical` div so hosts can drag-grow the editor (matches PR1's textarea UX). `@monaco-editor/react` calls `editor.layout()` via ResizeObserver automatically.

### Worker config

Configure `self.MonacoEnvironment.getWorker` (in module scope of `ScriptEditor.tsx` or a sibling init module):

```ts
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};
```

Vite handles `?worker` natively; no `vite-plugin-monaco-editor` needed.

### Loading + error UX

- **Loading**: while Monaco's chunk loads (`React.lazy`), Suspense fallback is a "Loading editor…" placeholder div (read-only, centered, ~220px tall to match the editor region). Hosts wait ~1–2s on first open; preload-on-hover hides it when the host's mouse passes over the button before clicking.
- **Failure**: ErrorBoundary wrapping the Suspense boundary catches Monaco load failures (network error, lockdown crash, etc.). Fallback shows: "Editor failed to load — using plain textarea. Reload to retry." plus a functional textarea so the host is never blocked.

### Drift guardrail

`script-globals.test.ts` imports both:
1. The runtime classes (`Game` from `./Game.ts`, `EntityFacade` from `./EntityFacade.ts`, `SceneFacade` from `./SceneFacade.ts`).
2. The editor-facing types from `./script-globals-types.ts`.

Asserts structural assignability via TS-level `Expect<…>` helper:

```ts
type _CheckEntity = Expect<EntityFacade extends EditorEntityFacade ? true : false>;
type _CheckScene  = Expect<SceneFacade extends EditorSceneFacade ? true : false>;
type _CheckGame   = Expect<Game extends EditorGame ? true : false>;
```

`tsc -b` fails if a runtime method is added without a corresponding entry in `script-globals-types.ts`. Forces every public-API change to update the editor surface in lock-step.

### Tests (PR2)

- **Unit tests stay valid**: existing `ScriptEditorModal.test.tsx` (from PR1) doesn't change — it mocks the editor with a textarea via `vi.mock('./ScriptEditor')`. The mock keeps tests fast and avoids fighting jsdom over Monaco.
- **Drift test**: `script-globals.test.ts` runs in `pnpm typecheck` — failing assignability surfaces as a `tsc` error.
- **Playwright extension**: extend the PR1 smoke test to verify that after the modal opens, an element with the Monaco editor class (`.monaco-editor`) is present. Confirms Monaco mounted in real-browser context.

### Verification (PR2)

1. **Dev**: `pnpm --filter client dev` → open Room as host → hover Edit Script (preload triggers) → click → modal opens, Monaco renders within ~200ms.
2. Type `export default class extends Game { onScriptLoaded(scene) { scene.` → autocomplete shows `getObjectById`, `getObjectsByTag`.
3. Type `scene.getObjectById(123)` → red squiggle under `123`.
4. Hover `Game` → tooltip shows class type from the `.dts`.
5. Save / Run still work; Ctrl+S / Ctrl+Enter still work.
6. **Prod**: `pnpm --filter client build && pnpm --filter client preview` → repeat 1–5. Editor must not throw under prod-mode `lockdown()`.
7. **Drift sim**: add a method to `EntityFacade.ts`, do *not* update `script-globals-types.ts`, run `pnpm typecheck` → fails. Update types → passes.
8. **Bundle check**: confirm Monaco lands in its own chunk (~1MB gz) in `dist/assets/`, not in the main entry chunk.
9. **Failure path**: temporarily break the Monaco import in dev, confirm the ErrorBoundary fallback (textarea + error message) renders, and Save/Run still function.
10. Playwright smoke test passes (now also asserting `.monaco-editor` mounts).

---

## Out of scope

Explicitly *not* addressed by this upgrade — flag now if any should be promoted:

- Save-file-load while the modal is open silently overwrites in-flight edits (today's behavior, unchanged).
- Script source changes do not participate in `SceneHistoryService` undo/redo (today's behavior, unchanged).
- No autosave-on-room-save or debounced autosave-on-keystroke; explicit Save Script remains the only commit path.
- No find/replace UI beyond what Monaco gives free in PR2.
- No multi-file scripting (single-file architecture decision per `planning/scripting-architecture.md`).
- No theme switching (`vs-dark` hardcoded).
- No per-host editor preferences (font size, tab width).

## Critical files

PR1:
- `packages/client/src/components/HostActionBar.tsx` (modify)
- `packages/client/src/components/ScriptEditorModal.tsx` (new)
- `packages/client/src/components/ScriptPanel.tsx` (delete)
- `packages/client/src/pages/Room.tsx` (modify, lines 64-65 + 391-401)
- `packages/client/src/scripting/ScriptHost.ts` (modify `runScript` to push compile errors into `errorLog_`)
- World wiring (add `getSavedScriptSourceRef` getter)
- `e2e/script-editor.spec.ts` (new) + `playwright.config.ts` (new)

PR2:
- `packages/client/src/components/ScriptEditor.tsx` (new)
- `packages/client/src/components/ScriptEditorModal.tsx` (modify — Suspense + ErrorBoundary, textarea → ScriptEditor)
- `packages/client/src/components/HostActionBar.tsx` (modify — add hover preload)
- `packages/client/src/scripting/script-globals-types.ts` (new)
- `packages/client/src/scripting/script-globals.dts` (new, generated)
- `packages/client/src/scripting/script-globals.test.ts` (new)
- `packages/client/scripts/gen-script-globals.ts` (new)
- `packages/client/src/vite-env.d.ts` (new)
- `packages/client/src/scripting/bootstrap.ts` (modify only if spike requires lockdown relaxation)
- `packages/client/package.json` (add deps + script)
