# Issues — Custom Scripting (First Iteration)

Source: `prd--scripting-v1.md`. Each section below is one independently-grabbable vertical slice.

---

## #1 — First-run script pipeline ✅ Done

**Type:** AFK
**Blocked by:** None — can start immediately

### What to build

End-to-end pipeline that lets the host type TypeScript into a panel, hit "Run Script", and see `console.log` output from inside a sandboxed script. No scene access, no events, no persistence yet — just the load/compile/sandbox/run path with the bare-minimum surfaces around it.

Touches every layer:
- New `ScriptPanel` React component with a `<textarea>` and two buttons (`Save Script` is wired up but a no-op until #2; `Run Script` triggers the pipeline).
- New `Compiler` module wrapping `ts.transpileModule` with dynamic-imported `typescript`.
- New `Sandbox` module wrapping SES `Compartment` (module compartment so `export default class` parses; no `lockdown()` in dev).
- New `ScriptHost` orchestrator composed into `World` on host construction. Public surface for this slice: `runScript(source)`.
- New empty `Game` marker class exposed to the script via the Compartment globals.
- Compile errors render in a block beneath the textarea; runtime errors `console.error` for now.

### Acceptance criteria

- [x] Host opens the script panel, types `export default class extends Game { onScriptLoaded() { console.log('hi') } }`, clicks Run, and sees `hi` in devtools.
- [x] A syntax error in the source surfaces a non-empty TS diagnostic message in the panel beneath the textarea; previously-running script (if any) is unaffected.
- [x] An attempt to access `window`, `document`, `setTimeout`, `setInterval`, `fetch`, or `XMLHttpRequest` from the script throws or yields `undefined` (Compartment-default behaviour).
- [x] `Math`, `JSON`, `Promise`, `Array` are usable from inside the script.
- [x] Hooks not overridden by the author (e.g. `onSceneInitialised`) default to no-op via the empty `Game` base.
- [x] `typescript` is dynamic-imported on first compile, not in the main bundle.
- [x] `ScriptHost` is composed into `World` only on host construction; guests construct `World` without it.
- [x] Unit tests cover `Compiler` (valid TS happy path, syntax error path) and `Sandbox` (default-export retrieval, blocked-globals, intrinsics-available).

### Stories covered

1, 2, 4, 8, 9, 10, 24, 27, 29, 30

---

## #2 — Source persistence in save format ✅ Done

**Type:** AFK
**Blocked by:** #1

### What to build

The Save Script button persists the textarea's source into room state, the save-file envelope carries the script, and loading a save restores the script source into the panel. No execution-on-load yet — that lands in #3.

- Add `room.script: { source: string, initialised: boolean }` to the host's `World` state. `initialised` defaults `false` and is unused this slice.
- Replace the existing `script: null` reservation in `SaveFile.SaveEnvelope` with `script: { source, initialised }`. `encodeSaveFile` writes it; `decodeSaveFile` validates the shape and tolerates a missing `script` field for back-compat (treats as `{ source: '', initialised: false }`).
- Save Script button writes the textarea content to `room.script.source`.
- On save-file load, the panel's textarea is populated from `room.script.source`.

### Acceptance criteria

- [x] Host types a script, clicks Save Script, downloads a save file via the existing save flow; opening the JSON shows `script: { source: "...", initialised: false }`.
- [x] Loading that save in a fresh session populates the panel's textarea with the saved source.
- [x] Loading an existing pre-scripting save (no `script` field) succeeds, with the panel showing an empty textarea.
- [x] Decoding a save with malformed `script` (e.g. `script: "not an object"`) throws a `SaveFileError`.
- [x] Unit tests cover `SaveFile` encode/decode for the new shape, the back-compat path, and the malformed-script rejection.

### Stories covered

3, 21, 34

---

## #3 — Idempotent Run with init flag + auto-Run on save load ✅ Done

**Type:** AFK
**Blocked by:** #1, #2

### What to build

`onSceneInitialised` becomes a real first-class hook gated by `room.script.initialised`. Run Script becomes idempotent. Loading a save automatically Runs the script through the same path. Undo/redo paths stay script-free.

- `ScriptHost.runScript(source)` Run flow:
  1. Compile new source. On failure, leave old script live, surface diagnostic.
  2. Tear down old script's listener registrations (no-op until #5).
  3. Instantiate new class.
  4. If `room.script.initialised === false`: try-catch `onSceneInitialised(scene)`, flip flag to `true`. Then try-catch `onScriptLoaded(scene)`. If `true`: only `onScriptLoaded`. Each hook is wrapped individually.
- New `ScriptHost.loadScript({ source, initialised })` invoked by `World` during save-file load (after `replaceScene` populates entities). Re-uses the same Run flow.
- `SceneHistoryService.replaceScene` does **not** call into `ScriptHost`. Listeners attached against entities that survive undo/redo continue to work.
- A `scene` global is wired into the Compartment for this slice as a placeholder `{}` (real `SceneFacade` lands in #4); hooks can be invoked even though the scene API isn't usable yet.

### Acceptance criteria

- [x] On a fresh room: clicking Run Script with a script that defines both hooks fires `onSceneInitialised` once, then `onScriptLoaded`. `room.script.initialised` is now `true`.
- [x] Clicking Run Script a second time fires only `onScriptLoaded`. `onSceneInitialised` does not re-fire.
- [x] Loading a hand-crafted save with `initialised: false` runs both hooks; loading a save with `initialised: true` runs only `onScriptLoaded`.
- [x] An exception thrown by `onSceneInitialised` is caught; `onScriptLoaded` still fires for the same Run.
- [x] A compile failure on a re-Run leaves the previously-running instance alive (its listeners would still fire if any were registered).
- [x] Undoing a scene mutation (via the existing history flow) does not call into `ScriptHost`; no extra hook invocations and no listener double-registration.
- [x] Integration tests cover all six combinations of (fresh / re-Run / save-load) × (`initialised` true / false).

### Stories covered

5, 6, 7, 22, 23, 33

---

## #4 — Scene query + read-only entity facade ✅ Done

**Type:** AFK
**Blocked by:** #1

### What to build

The `scene` global exposed to scripts becomes a real `SceneFacade` that wraps `SceneImpl`. Locating entities returns `EntityFacade` instances exposing the read-only fields. No mutation surface yet (that's #5/#6).

- New `SceneFacade` with `getObjectById(id)` and `getObjectsByTag(tag)` returning `EntityFacade` instances or undefined.
- New `EntityFacade` exposing `id`, `type`, `tags`, `name`, and `getComponent(typeId)` returning a read-only view of `state` (no methods, no mutation).
- `EntityFacade` instances are constructed per Run (so listener tracking and other per-Run state is local). `SceneFacade` constructs them on demand.
- The Compartment's `scene` global is replaced with the live `SceneFacade` for the current Run.

### Acceptance criteria

- [x] A script that does `scene.getObjectsByTag('die').map(d => d.name)` returns the names of all dice in the room.
- [x] `scene.getObjectById('not-real')` returns `undefined`.
- [x] `entity.tags` returns the entity's tag list; mutating the returned array does not affect the underlying entity.
- [x] `entity.getComponent('value')` returns an object with the component's `state` accessible; calling component mutators on the result does not work (read-only).
- [x] Unit tests cover `SceneFacade` (query happy path, missing-id, no-tag-match) and `EntityFacade` (read-only invariants).

### Stories covered

11, 12

---

## #5 — `value-changed` event + listener teardown + `setValue` ✅ Done

**Type:** AFK
**Blocked by:** #4

### What to build

The PoC scenario lands here: a script registers a listener on a die and logs each time it settles. Adds the entity-level event bus, dispatch from `ValueComponent`, listener registration tracking, and the first mutation method on the facade.

- New `EntityEventBus` per `Entity` (owned inline). `addListener(name, cb)`, `removeListener(name, cb)`, `dispatch(name, payload)`.
- `ValueComponent.setState` calls `entity.dispatchEvent('value-changed', { value, isNumeric })` only when the resolved `value` differs from the previous value.
- `EntityFacade.addEventListener(name, cb)` records `(entityId, name, cb)` into a per-Run registration set on `ScriptHost`. `removeEventListener` un-registers.
- `ScriptHost`'s teardown step (currently a no-op from #3) iterates the registration set and calls `removeListener` on the underlying buses, then clears the set. Hooked into the Run flow before instantiating the new class.
- `EntityFacade.setValue(v)` calls the underlying `ValueComponent.setState` (which now dispatches the event for free).

### Acceptance criteria

- [x] PoC: host writes a script that, in `onScriptLoaded`, calls `scene.getObjectsByTag('die').forEach(d => d.addEventListener('value-changed', e => console.log(d.name, e.value)))`. Rolling a die emits exactly one log with the settled value.
- [x] Setting `value` to its current value via `ValueComponent.setState` dispatches **nothing**.
- [x] After a re-Run, the previous listener does not fire on subsequent dispatches; the new listener does.
- [x] `entity.removeEventListener(name, cb)` removes only the targeted callback.
- [x] `entity.setValue('6')` updates the underlying `ValueComponent` state and replicates to guests via the existing patch flow.
- [x] An exception thrown inside a listener is caught (does not abort other listeners on the same dispatch); error path TBD by #7 — for now, `console.error` is acceptable.
- [x] Unit tests cover `EntityEventBus` (register/dispatch/remove, multi-listener fanout, dispatch with zero listeners), `ValueComponent` event emission (fires on change, silent on no-change), and `ScriptHost` listener teardown across Runs.

### Stories covered

13, 14, 15, 16, 17, 28, 31

---

## #6 — `customData` full stack ✅ Done

**Type:** AFK
**Blocked by:** #4

### What to build

Authors get a per-entity string map for persistent state, fully wired through replication and save/load.

- `Entity.customData: Map<string, string>`. Initialised empty in the constructor.
- `EntitySerialized.customData?: Record<string, string>` (optional for back-compat with pre-scripting saves; absent treated as empty).
- `entityToSerialized` writes the map as a plain object; `Scene.load` reconstructs the `Map`.
- `wire.ts` `entity-patch` envelope carries an optional full-map `customData: Record<string, string>` whenever any key changed since last flush.
- `HostReplicatorV2` enqueues a `customData` patch on mutation; guests apply by overwriting the map.
- `EntityFacade.setData(key, value)`, `getData(key)`, `deleteData(key)`. Setter and deleter route through the entity to enqueue replication. Reader returns the raw string or undefined.
- No Proxy on the underlying map; no `data-changed` event in this slice.

### Acceptance criteria

- [x] A script that does `entity.setData('score', '0')` then `entity.setData('score', String(Number(entity.getData('score')) + 1))` increments correctly across multiple invocations.
- [x] After `setData`, `getData` returns the new value.
- [x] `deleteData` followed by `getData` returns `undefined`.
- [x] Mutating an entity's `customData` on the host triggers an `entity-patch` to guests; the guest's `Entity.customData` reflects the new state.
- [x] Save → load round-trip preserves `customData` keys and values exactly.
- [x] Loading a pre-scripting save (entities without `customData`) succeeds and yields entities with empty `customData` maps.
- [x] Unit tests cover the round-trip (host mutate → wire → guest apply), save/load symmetry, and the back-compat path.

### Stories covered

18, 19, 20, 31

---

## #7 — Runtime error log UI ✅ Done

**Type:** AFK
**Blocked by:** #1

### What to build

Promote the runtime-error path from `console.error`-only to a structured log surfaced in the script panel.

- New `ScriptErrorLog` ring buffer (cap ~10). Each entry: `{ timestamp, source, firstLine }`. Observable via subscriber callbacks.
- `ScriptHost` funnels every caught hook error and (once #5 lands) every caught listener error into the log. Source labels: `onSceneInitialised`, `onScriptLoaded`, `event:value-changed`, etc.
- Errors continue to be `console.error`-logged in addition to going to the log.
- `ScriptPanel` renders the log entries beneath the runtime area: timestamp + source + first stack line, plus a `Clear` button.
- Compile errors continue to render inline beneath the textarea (already from #1); they are **not** funnelled into this log.

### Acceptance criteria

- [x] A script that throws inside `onScriptLoaded` shows up as one entry in the panel's error list with the correct source label.
- [x] A listener that throws on every dispatch produces one entry per invocation; older entries roll off once the cap is hit.
- [x] `Clear` empties the list.
- [x] Devtools `console.error` continues to receive every error in addition to the panel log.
- [x] Subscribers (the panel) are notified on push and on clear.
- [x] Unit tests cover `ScriptErrorLog` (cap, drop-oldest, ordering preserved, `clear()`, subscriber notifications).

### Stories covered

25, 26

---

## #8 — Prod-only `lockdown()` ✅ Done

**Type:** AFK
**Blocked by:** #1

### What to build

Application bootstrap conditionally calls SES `lockdown()` once, at the top of the client entrypoint, in production builds only. Dev builds skip it so HMR and devtools stay friendly.

- Add `if (import.meta.env.PROD) lockdown(...)` at the top of the client entrypoint, before any other imports that may construct prototypes or freeze intrinsics.
- Pick a sensible options shape (e.g. `errorTaming: 'unsafe'`) — document in the entrypoint comment.
- `Sandbox` asserts (or warns) at construction time in prod that `lockdown` ran.

### Acceptance criteria

- [x] In a prod build, `Object.freeze(Array.prototype)` (or equivalent indicator) confirms intrinsics are frozen.
- [x] In a dev build, intrinsics are not frozen; HMR continues to work; the app boots without warnings.
- [x] No measurable slowdown to dev startup attributable to SES.
- [x] A short comment at the bootstrap site documents the why and the dev/prod split.

### Stories covered

32

---

## Dependency graph

```
#1 ─┬─ #2 ─── #3
    ├─ #4 ─┬─ #5
    │      └─ #6
    ├─ #7
    └─ #8
```
