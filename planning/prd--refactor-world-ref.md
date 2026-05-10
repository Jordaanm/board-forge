# PRD — SceneController Refactor (eliminate Room → ThreeCanvas refs)

## Problem Statement

`Room.tsx` currently passes ~50 `useRef` handles to `ThreeCanvas.tsx`, the majority of which are thin wrappers around methods that already exist on `World`. The pattern was introduced because `World` is created inside `ThreeCanvas`'s `useEffect`, so it doesn't exist at Room's first render. Each new scene operation (delete entity, draw card, mutate surface element, etc.) requires:

1. A new ref declaration in Room.
2. A new prop on ThreeCanvas.
3. An assignment of `.current` inside ThreeCanvas's effect.
4. A call site in some panel that has to thread the ref down.

This is mechanical, error-prone (silent regressions when a ref is never wired), and opaque to React (mid-session World swaps are invisible). The friction discourages adding panel features and bloats the ThreeCanvas prop interface.

## Solution

Expose the live `World` to React via a single state slot in Room, and have panels call its methods directly. Bundled with one renderer-layer helper (`captureThumbnail`) to support save/export. The `World` type aliases as `SceneController` for React-facing imports; the engine class keeps its name.

Concretely:
- ThreeCanvas gains one new callback prop, `onSceneReady(handle | null)`.
- Room holds `useState<SceneHandle | null>`; panels are gated on `isHost && handle` and receive the controller as a non-nullable prop.
- ~35 of the ~50 refs are deleted. The remaining ~15 (transport, tool state, camera, manifest, debug) keep their existing pattern — they're not scene operations.

## User Stories

1. As a developer adding a new scene operation (e.g. duplicate entity), I want to add one method to `World` and call it from the panel, so that I don't also have to declare a ref, add a ThreeCanvas prop, and wire `.current` inside an effect.
2. As a developer reviewing `Room.tsx`, I want the file to be short enough to scan in one screen, so that I can find the wiring for a given concern quickly.
3. As a developer reviewing `ThreeCanvas.tsx`'s prop interface, I want it to list its real responsibilities (rendering, input, peer wiring) and not be drowned in scene-mutate function pointers, so that I can reason about what the canvas component does.
4. As a developer working in a panel (`EditorPanel`, `HostActionBar`, `HandPanel`), I want to receive a single `controller` prop and call methods on it, so that I don't thread 8–12 separate refs per panel.
5. As a developer debugging a regression where a scene operation silently does nothing, I want call sites to be type-checked against the actual `World` method signatures, so that a renamed method is a compile error rather than a `noop` ref.
6. As a developer adding a panel that observes scene state, I want a one-line `useSceneObjects(controller)` hook, so that I don't re-implement `useEffect` + `world.subscribe` per panel.
7. As a developer writing the save flow, I want `world.snapshot()` and `captureThumbnail()` to be composable separately, so that I can write the encode/download step as a pure utility without coupling it to the renderer.
8. As a developer in a guest session, I want the same `controller` object my host code uses, so that panels written for host don't need a parallel "guest" implementation — guest-illegal methods throw at the engine boundary as they already do.
9. As a developer using StrictMode in dev, I want the panel mount sequence to handle the brief `null → handle → null → handle` flicker without remounting panels into broken state, so that I'm not chasing dev-only bugs.
10. As a host running the app, I want every existing scene operation (spawn, delete, edit, save, load, hand drag, deck draw, script run) to behave identically before and after the refactor, so that the refactor is a no-op for users.
11. As a guest running the app, I want scene mutations to continue replicating from host normally, so that the refactor is invisible at runtime.
12. As a developer migrating a panel, I want the prop type to enforce non-null `controller`, so that I never accidentally call `.spawn(...)` on `null` because Room failed to gate.
13. As a developer touching the engine layer (`ContextMenuController`, `ToolDispatcher`, `InputDispatcher`), I want to keep importing `World` (the engine type), not the UI alias, so that engine code doesn't acquire a UI-layer naming dependency.
14. As a future contributor, I want the design doc and PRD to call out which refs are *intentionally* not collapsed (transport, tool state, camera, manifest), so that I don't redo this analysis.

## Implementation Decisions

### Modules built/modified

**New**
- `SceneHandle` interface and `SceneController` type alias — exported from the engine `types.ts` next to `World`. `SceneController` is `World`; `SceneHandle = { controller: SceneController; captureThumbnail(): string | null }`.
- `useSceneObjects(controller, isHost)` — custom hook colocated with `EditorPanel` (or in a hooks dir if more emerge). Wraps `useEffect` + `useState` + `world.subscribe` + `entityToObjectSummary`.
- `downloadSceneFile(snapshot, thumbnail, manifest, script)` — pure utility that encodes the envelope and triggers the file download. Extracted from ThreeCanvas's current `saveScene` ref body.
- `captureThumbnail()` factory — closes over the WebGL renderer + scene + camera; produced inside ThreeCanvas's effect and embedded in the `SceneHandle`.

**Modified**
- `ThreeCanvas` — gains `onSceneReady` prop; loses ~35 refs from its prop interface. Internal `useEffect` calls `onSceneReady(handle)` after world construction; cleanup calls `onSceneReady(null)`.
- `Room` — replaces ~35 `useRef` declarations with a single `useState<SceneHandle | null>`. Render gates panels on `isHost && handle`. Wires inbound `ConnectionManager` events directly to `handle?.controller.transport.deliver(...)` / `handle?.controller.releasePeer(...)` instead of via refs.
- `EditorPanel` — prop interface changes from many refs to `controller: SceneController` plus the small set of non-scene props it still needs (selection state, free-camera toggle, manifest store, tools).
- `HostActionBar` — receives `handle: SceneHandle`. Save handler composes `controller.snapshot()`, `handle.captureThumbnail()`, and `downloadSceneFile(...)` directly. Load handler calls `controller.replaceScene(...)` directly.
- `HandPanel` — calls `controller.playCardToTable(...)`, `controller.reorderHand(...)`, `controller.fireInputEvent(...)` directly.
- `Toolbar` — unchanged in this refactor; tool state is out of scope.

### Architectural decisions

- `World` retains its name in engine code. The `SceneController` alias is the React-facing symbol. No god-object rename.
- `World` does **not** gain UI-shape methods (`getObjectSummaries`, `exportSceneFile`, `requestContextMenu`). Those orchestrations live where they're consumed — Room or a panel — composed from `World`'s primitives.
- `captureThumbnail` lives on the `SceneHandle`, not `World`, because it's a renderer concern. Putting it on `World` would leak WebGL into the engine.
- The non-scene refs (transport, tool state, camera, manifest, debug) are explicitly out of scope. Their owners (transport object, ToolDispatcher, CameraController, ManifestStore) are coherent boundaries already; bundling them now would recreate the god-object problem the refactor escapes.
- Subscriptions use `useEffect` + `useState` + `world.subscribe`, not `useSyncExternalStore`. The latter requires referentially stable snapshots, forcing memoization inside `World` for a benefit (concurrent rendering safety) the codebase doesn't currently exercise.
- Render gating uses parent-side `{isHost && handle && <Panel ... />}`, mirroring the existing `{isHost && ...}` convention. Panel prop types are non-nullable.
- Engine-internal consumers (`ContextMenuController`, `ToolDispatcher`, `InputDispatcher`, `PingOverlay`) continue receiving `World` directly via constructor arg from inside `ThreeCanvas`. They import `World`, not `SceneController`.

### Rollout

Single PR, big-bang. Mechanical changes touching `Room.tsx`, `ThreeCanvas.tsx`, and every panel that holds refs. Smoke-test the host editing flow, save/load round-trip, hand drag, deck operations, scripting, and guest replication before merging.

## Testing Decisions

A good test in this codebase exercises external behavior — what a host or guest can do — not implementation details like which ref is wired or which closure runs first. Tests should fail when the user-visible contract breaks, and ignore reorganization that preserves behavior.

**What to test**
- `useSceneObjects` hook: given a controller, mounts and reflects an initial snapshot; updates when the controller fires `subscribe`; cleans up its subscription on unmount; handles `null` controller without throwing. Render-test using existing React Testing Library setup (see `EditorPanel.test.tsx` for prior art).
- `downloadSceneFile`: pure function, deterministic envelope shape given snapshot + thumbnail + manifest + script. Test envelope structure and that the download trigger fires (via a mock). No DOM assertion needed beyond invocation.
- `EditorPanel` props migration: extend the existing `EditorPanel.test.tsx` to render with a fake `controller` (a partial `World`-shaped object) and assert that panel actions invoke the right controller methods. This catches the "ref renamed but call site stale" class of regression.

**What not to test**
- ThreeCanvas's `onSceneReady` callback timing — that's a useEffect lifecycle concern; React owns it.
- The `SceneController` alias — it's a type; tsc covers it.
- That `Room` no longer holds 50 refs — that's a structural assertion masquerading as a test.

**Prior art**
- `EditorPanel.test.tsx` for panel prop-flow assertions with React Testing Library.
- Any existing pure-function utility tests in the client package for the `downloadSceneFile` shape.

## Out of Scope

- Migration of non-scene refs (transport, selection/tool state, camera, manifest, debug) into companion artifacts. Tracked as future work; revisit only if those refs accumulate similar friction.
- Renaming `World` to `SceneController` in engine code. The alias is sufficient.
- Narrowing `SceneController` to a sub-interface of `World` to hide `physics` / `replicator` / `transport` from UI. No evidence panels are reaching into private bits; revisit if a panel does.
- Replacing `useEffect` + `useState` subscriptions with `useSyncExternalStore`. Premature; revisit when concurrent rendering features are adopted.
- Any change to the host/guest replication protocol or to `World`'s host-only method gating. Methods continue to throw on guest as they do today.
- Any change to engine-internal classes (`ContextMenuController`, `ToolDispatcher`, `InputDispatcher`, `PingOverlay`) beyond adjusting their import path if it changes (it doesn't).

## Further Notes

- Friction signal driving this work: the recent "delete entity from editor panel" feature required threading a single new ref, and the plumbing was bigger than the actual change. Multiplied across the planned features in `todo.md` (multiselect, magnets, PDF viewer, scriptable UI, new spawnable entities, drag-to-resize), the per-feature plumbing tax is significant.
- The big-bang rollout is a deliberate choice over an incremental panel-by-panel sequence. It trades a longer single PR for avoiding a multi-PR coexistence period where some panels use refs and others use the controller. Half-day of focused work + manual smoke-testing.
- After the refactor lands, `Room.tsx`'s ref count drops from ~50 to ~15. The remaining 15 are the natural set for a follow-up consolidation pass (e.g. `RoomController` bundling transport + seat helpers, `ToolController` bundling selection + active tool) if and when that surface starts to show its own friction.
- Source: design captured in [planning/refactor-world-ref.md](planning/refactor-world-ref.md).
