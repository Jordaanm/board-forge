# Issues — SceneController Refactor

Source: [planning/prd--refactor-world-ref.md](prd--refactor-world-ref.md)

---

## Issue 1 — Extract `downloadSceneFile` pure utility from `ThreeCanvas` save flow ✅

**Type:** AFK

**Status:** Complete

### What to build

`ThreeCanvas`'s current save flow inlines envelope encoding (snapshot + manifest + script + thumbnail) and the file-download trigger inside a `saveSceneRef.current = () => { ... }` closure. Extract that body into a standalone pure utility, `downloadSceneFile(snapshot, thumbnail, manifest, script)`, and call it from the existing closure. No behavior change. This lands independently and shrinks the diff of the follow-up refactor.

### Acceptance criteria

- [x] A pure `downloadSceneFile` function exists, accepting snapshot, thumbnail (string | null), manifest, and script, and producing the same downloaded envelope the current inline code produces.
- [x] `ThreeCanvas`'s save closure calls the new utility instead of inlining the work.
- [x] Save round-trip (export → reload → verify scene matches) behaves identically to before.
- [x] Unit test covering the envelope shape and that the download trigger is invoked (with the trigger mocked).
- [x] No other call sites are touched.

### Blocked by

None - can start immediately.

---

## Issue 2 — SceneController refactor: eliminate ~35 Room → ThreeCanvas refs

**Type:** AFK

### What to build

Expose the live `World` from `ThreeCanvas` to `Room` via a single state slot, and have host-side panels call its methods directly. Add a `SceneController` type alias for `World` (React-facing symbol; engine retains `World`). Bundle the controller with a `captureThumbnail()` factory into a `SceneHandle`. Replace ~35 `useRef`-and-prop pairs across `Room.tsx` and `ThreeCanvas.tsx` with the handle. Migrate `EditorPanel`, `HostActionBar`, and `HandPanel` to accept the controller (or handle) as a non-nullable prop, gated by `{isHost && handle && ...}` at the parent. Add a `useSceneObjects(controller, isHost)` hook for read subscriptions. Compose the save flow in `HostActionBar` from `controller.snapshot()` + `handle.captureThumbnail()` + `downloadSceneFile(...)` (from Issue 1). Out of scope: the ~15 non-scene refs (transport, tool state, camera, manifest, debug).

### Acceptance criteria

- [ ] `SceneController` type alias and `SceneHandle` interface exported from the engine types module.
- [ ] `ThreeCanvas` accepts an `onSceneReady(handle | null)` callback; fires the handle after world construction and `null` on cleanup.
- [ ] `Room` holds the handle in `useState`; panels are gated on `isHost && handle` and receive non-nullable props.
- [ ] ~35 refs identified in the PRD are deleted from both `Room` and `ThreeCanvas` (scene-mutate, hand/drag, save/load, reads, scripting, peer-lifecycle subset).
- [ ] The ~15 non-scene refs (transport, tool state, camera, manifest, debug) are unchanged.
- [ ] `useSceneObjects` hook implemented; `EditorPanel` uses it to render the scene graph list.
- [ ] `HostActionBar` save flow composes `controller.snapshot()` + `handle.captureThumbnail()` + `downloadSceneFile(...)` directly; load flow calls `controller.replaceScene(...)` directly.
- [ ] `HandPanel` calls controller methods directly for play-to-table, reorder, and input events.
- [ ] Engine-internal consumers (`ContextMenuController`, `ToolDispatcher`, `InputDispatcher`, `PingOverlay`) continue receiving `World` directly via constructor arg.
- [ ] Existing `EditorPanel.test.tsx` extended to render with a fake controller and assert that panel actions invoke the right controller methods.
- [ ] `useSceneObjects` hook has a render test covering: initial snapshot reflected, updates on `subscribe` fires, cleanup on unmount, null controller handled.
- [ ] All existing user-facing flows behave identically: host spawn, delete, edit fields, surface elements, save/load round-trip, hand drag, deck draw/shuffle/deal, script run, guest scene-mutation replication.
- [ ] `tsc` and the existing test suite pass.

### Blocked by

- Blocked by #1
