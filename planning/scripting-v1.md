# Custom Scripting — First Iteration Spec

Subset of `planning/scripting-architecture.md` locked for v1. Tracer-bullet scope: prove the load → compile → sandbox → event-listener pipeline end-to-end. PoC scenario: a script that logs when a die is rolled.

## Scope

In:
- SES `Compartment` sandbox + browser-side TS compilation
- Scene access (query) + entity-level DOM-style event listeners
- Single `value-changed` event
- Scripts saved with the room state, run via explicit Run Script (auto-fires on save-file load)

Deferred:
- `clone` / `cloneFromGUID` / `scheduleAfter` / `scheduleRepeating`
- `onPlayerJoined`, `onPlayerLeft`, `onPlayerChangedSeat`, `onGameReset`
- Additional events (`zone-enter`, `zone-exit`, `collision`, `data-changed`, ...)
- Monaco / improved editor, file import/export, compile cache, multi-file modules
- Guest-facing error notice
- Full `lockdown()` in dev

## Authoring UX

Single script panel with a `<textarea>` and two buttons:
- **Save Script** — persists `room.script.source` to room state.
- **Run Script** — compiles + applies textarea content. Idempotent.

Compile errors render below the textarea. Runtime errors render in an error list in the same panel.

## Script contract

```ts
export default class MyGame extends Game {
  onSceneInitialised(scene) { ... }   // fires once per game lifetime
  onScriptLoaded(scene)     { ... }   // fires every Run
}
```

- `Game` is an empty marker class. Hooks default to no-op.
- Single TS file, default export.
- Module compartment (not `evaluate`) — so `export default class` parses.

### Compartment allowlist

- `Game`, `scene`, `console`
- Standard JS intrinsics via Compartment defaults (`Math`, `JSON`, `Array`, `Promise`, ...)
- No `window`, `document`, `setTimeout`, `setInterval`, `fetch`, `XMLHttpRequest`

### Sandboxing

- `lockdown()` called only in prod builds (`if (import.meta.env.PROD) lockdown()`).
- Dev uses `Compartment` without `lockdown()` — namespace isolation only. v1 trusts host-authored scripts; lockdown lands when scripts become shareable.

## Run Script (idempotent)

1. Compile textarea content. Failure → old script stays live, error in panel.
2. Tear down all listeners registered by old script.
3. Instantiate new class.
4. Run hooks based on `room.script.initialised`:
   - `false` → `onSceneInitialised(scene)`, flip flag to `true`, then `onScriptLoaded(scene)`
   - `true`  → `onScriptLoaded(scene)` only
5. Each hook is wrapped in try/catch; errors logged, don't abort the rest.

Same flow runs on save-file load (file's `initialised` flag drives whether init fires). Undo/redo paths (`replaceScene` from `SceneHistoryService`) do **not** run the script.

## Scene API

```ts
scene.getObjectById(id)              // → entity | undefined
scene.getObjectsByTag(tag)           // → entity[]

entity.id
entity.type
entity.tags
entity.name
entity.value                         // ValueComponent.state.value shorthand
entity.setValue(v)
entity.getData(key)                  // customData read
entity.setData(key, value)           // customData write — replicates
entity.deleteData(key)
entity.addEventListener(name, cb)
entity.removeEventListener(name, cb)
entity.getComponent(typeId)          // read-only state escape hatch
```

The script-facing `entity` is a script-scoped wrapper, not the raw `Entity` data class or the existing `EntityHandle`. Wrapper records every `addEventListener` call into a per-script registry for teardown on next Run.

## Events

- Listeners live on the entity wrapper; runtime registry `Map<entityId, Map<eventName, callback[]>>`.
- Components dispatch via `entity.dispatchEvent(name, payload)`.
- v1 emits exactly one event: **`value-changed`** from `ValueComponent.setState` when `value` actually changes. Payload `{ value, isNumeric }`.
- Dice fire it transitively — `DiceComponent.handleStopMoving` already updates `ValueComponent`, so a die settling fires `value-changed`.
- Script-system teardown on Run: iterate the script's listener-registration set, call `removeEventListener` on each, clear the set.

## Persistent state

`Entity` gains:

```ts
customData: Map<string, string>
```

- Authors store cross-Run state in `customData` or in dedicated value-bearing entities.
- Class instance fields are transient — wiped on every Run. Document this convention.
- Wire format: included in `entity-patch` as full `Record<string, string>` whenever any key changes (per-key delta deferred).
- Save format: `EntitySerialized.customData` as plain object.
- Mutation API: `entity.setData / getData / deleteData`. No Proxy on the underlying map.
- No `data-changed` event in v1.

## Compilation

- `typescript` package dynamic-imported via Vite chunk on first compile (~3 MB stays out of the main bundle).
- `ts.transpileModule` — type-strip only, no type checking, no import resolution.
- No compile cache in v1; recompile on every Run.
- Compile errors surface as TS diagnostic messages in the panel.

## Save format

Replaces the existing `script: null` reservation in `SaveFile.ts`:

```ts
SaveEnvelope.script = {
  source:      string,
  initialised: boolean,    // default false on fresh room state
}
```

`decodeSaveFile` validates shape; missing `script` field tolerated for back-compat with existing saves (treated as `{ source: '', initialised: false }`).

## Errors

- Compile errors: in panel, beneath textarea.
- Runtime errors: `console.error` + last ~10 in the panel's error list. Each entry: timestamp + hook/event source + first stack line. "Clear" button.
- No guest-facing error notice in v1 — players see normal physics state, scripting is invisible to them.

## Open implementation details

Decided as defaults — flag if revisiting:

- Script-system code lives in a new `packages/client/src/scripting/` module. `ScriptHost` service composed into `World` on host construction.
- Entity wrapper exposed to scripts is a fresh class (`ScriptEntity`?), constructed per-Run, holding a back-reference to the underlying `Entity` and the script's listener registry.
- `console` exposed in the Compartment is the host's real `console` (debug logs go to devtools). A panel-routed logger lands later.
- `Game` constructor takes no args. Scripts use the `scene` global directly; `this.scene = scene` is an author convention if they want it on the instance.
