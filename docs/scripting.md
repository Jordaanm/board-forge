# Scripting

A room can carry a custom script that the host authors directly in the browser. The script is plain TypeScript — it compiles in-app, runs in a sandboxed compartment, and can react to events on entities or drive them programmatically. This page walks through writing a script and covers the most-used pieces of the script-facing API. It is not an exhaustive reference; the source under `packages/client/src/scripting/` is.

## Where scripts live

Scripts are per-room. As host, click **Edit Script** on the action bar to open the editor. The editor is Monaco-based (full syntax highlighting and TypeScript awareness) and seeds with a commented-out example on first open:

```ts
// Edit and click Run.
//
// export default class extends Game {
//   onScriptLoaded(scene) { console.log('hi') }
// }
```

The modal has three controls:

- **Run** compiles the source and starts a new "Run" against the live scene. If compile fails the previous Run keeps working and the diagnostic is added to the error log.
- **Save Script** persists the source so it travels with the room and is included in saves.
- **Close** dismisses the modal. If the source differs from the saved version you'll get a confirmation prompt.

The error log inside the modal shows the most recent compile and runtime errors, including listener exceptions, with a per-entry source label.

## Authoring a script

A script is a TypeScript module that default-exports a class extending `Game`. The harness imports the module, instantiates the class, and calls two lifecycle hooks on it:

```ts
export default class extends Game {
  // Fires once per room — the first time the script runs on this room.
  // Use this for room-creation work (spawning starting pieces, seeding state).
  onSceneInitialised(scene) {
    // ... one-time setup
  }

  // Fires every time the script runs (Save+Run, save-file load, save-file
  // reload). Use this to attach event listeners — it's the right hook for
  // everything that needs to be wired up "now".
  onScriptLoaded(scene) {
    // ... per-Run setup (mostly listeners)
  }
}
```

`Game` is a thin marker base class — both hooks default to no-ops, so a script that only needs one can omit the other.

When you click **Run**, the harness compiles the source, tears down the previous Run's listeners, instantiates your class, and calls the hooks. `onSceneInitialised` only fires the first time — its "first time" flag is persisted in the room state and survives save/load. So the typical pattern is:

- Spawn or configure starting pieces in `onSceneInitialised`.
- Attach event listeners in `onScriptLoaded`.

Hooks are wrapped in `try/catch` individually, so a throw in one hook doesn't abort the others; the error lands in the script panel's error log.

## A worked example

A short Game that watches every die in the scene and plays a sound whenever any of them is clicked:

```ts
export default class extends Game {
  onScriptLoaded(scene) {
    for (const die of scene.getObjectsByTag('die')) {
      die.addEventListener('click', () => {
        scene.playSound('dice-click');
      });
    }
  }
}
```

Notes on this example:

- `scene.getObjectsByTag(tag)` walks the live scene and returns an array of `EntityFacade` wrappers — read-mostly views over the underlying entity.
- `die.addEventListener(...)` attaches a listener to the entity's event bus. The registration is tracked on the active Run, so the next Run automatically tears it down before re-attaching.
- `scene.playSound(slug)` looks the slug up in the host's asset catalog (Asset Manager → Custom tab) and broadcasts a play to every peer. Unknown slugs and non-`sound` types log a warning and no-op.

If you re-Save+Run this script, the previous listeners are detached before the new ones are attached — you don't get duplicate fires.

## The `scene` API

`scene` is the parameter passed to your hooks. It exposes a small set of read methods plus a few host-only side effects.

| Member                                         | Purpose |
|------------------------------------------------|---------|
| `scene.getObjectById(id)`                      | Look up one entity by id. Returns an `EntityFacade` or `undefined`. |
| `scene.getTable()`                             | Convenience for the singleton Table entity. Same as `getObjectById(TABLE_ENTITY_ID)`. |
| `scene.getObjectsByTag(tag)`                   | All entities whose `tags` array contains the given tag. Returns `EntityFacade[]`. |
| `scene.playSound(slug)`                        | Host-only. Broadcast a one-shot sound by asset slug. No-op on guest contexts. |
| `scene.assets.get(slug)`                       | Look up one asset by slug in the live catalog. Returns a frozen `AssetEntry` or `null`. |
| `scene.assets.list({ type })`                  | List the catalog, optionally filtered to `'image' \| 'model' \| 'sound' \| 'spritesheet'`. Spritesheet entries carry extra `cols` / `rows` fields; address individual cells with a 3-segment ref like `'custom:deck:7'` anywhere an image ref is accepted. |
| `scene.attachSticker(parent, opts)`            | Host-only. Compose a child surface entity onto `parent` and append one element to it. Returns an `ElementHandle`. |
| `scene.getElement(surfaceId, elementId)`       | Re-acquire an `ElementHandle` for an element you previously attached. Useful for re-binding listeners after a Run. |

Lookups are stable within a Run — calling `scene.getObjectById('foo')` twice returns the same `EntityFacade` instance, so `===` comparisons work.

Anything that mutates the scene is host-only. On a guest context `scene.playSound` and `scene.attachSticker` warn and no-op.

## The `EntityFacade`

The `EntityFacade` is the wrapper your script gets back from `scene.getObjectById` / `scene.getObjectsByTag` / `scene.getTable`. It exposes:

| Member                                | Notes |
|---------------------------------------|-------|
| `entity.id`                           | The entity's stable id. |
| `entity.type`                         | The spawnable type (`'die'`, `'card'`, etc.). |
| `entity.name`                         | Display name. |
| `entity.owner`                        | `SeatIndex` (0–7) or `null` for unowned. |
| `entity.tags`                         | Defensive copy of the entity's tag list. Mutating the returned array does not affect the entity. |
| `entity.getComponent(typeId)`         | Frozen view of the named component's `state`. Returns `undefined` if the component isn't present. |
| `entity.addEventListener(evt, cb)`    | Subscribe to an event. Listener exceptions are caught and reported. |
| `entity.removeEventListener(evt, cb)` | Detach a single callback. |
| `entity.setValue(value)`              | Mutator for entities with a `ValueComponent` (dice, counters). No-op otherwise. |
| `entity.setData(key, value)`          | Per-entity persistent string map for cross-Run state. Replicates to guests. |
| `entity.getData(key)`                 | Read it back. |
| `entity.deleteData(key)`              | Remove the key. Returns `true` if a value was present. |

`getComponent(typeId).state` is a read-only snapshot. To mutate component-level state, use the dedicated mutator on the facade (`setValue`, `setData`) — there is no general-purpose state setter.

### Events

Entities dispatch a fixed set of input lifecycle events plus per-component domain events. The events you'll see most:

- `pressed`, `released`, `click` — pointer lifecycle. The payload carries `{ seat, shiftKey, ctrlKey, altKey }` and (for 3D-originated events) a `worldHit: { x, y, z }`.
- `hover-start`, `hover-end` — mouse over / out.
- `hover-move` — local-only; the hover target is unchanged but the hit position shifted. Does not replicate.
- `value-changed` — fired by `ValueComponent` (dice, counters) when the value settles.

Listener payloads include a `seat` field so a script can check who triggered the event. For 2D events originating in the hand panel (FlatView), `worldHit` is absent — `if (event.worldHit)` is the canonical way to discriminate 3D vs 2D.

If a listener throws, the bus catches the error, logs it to the script panel's error log under a source label of `event:<name>`, and continues delivering to the remaining listeners.

## The `ElementHandle`

`ElementHandle` is a wrapper for a single 2D element on a surface (sticker, image, shape, rich-HTML region). You get one from `scene.attachSticker(...)` or `scene.getElement(surfaceId, elementId)`.

The mutators are kind-aware: calling `setHtml` on an image element warns and no-ops rather than corrupting state.

| Member                                 | Notes |
|----------------------------------------|-------|
| `handle.surfaceId`, `handle.elementId` | Stable identifiers. Persist these in entity data if you need them across Runs. |
| `handle.setBounds(x, y, w, h)`         | Reposition / resize the element on its surface. |
| `handle.setHtml(html)`                 | Rich-element-only. Replace the element's HTML. |
| `handle.setImageRef(ref)`              | Image-element-only. Swap the texture reference. |
| `handle.setImageFit(fit)`              | Image-element-only. Change the fit mode. |
| `handle.setShape(opts)`                | Shape-element-only. Edit shape parameters. |
| `handle.addEventListener(evt, cb)`     | Per-element event bus — same names as entity-level events but scoped to clicks on the element rectangle. |
| `handle.removeEventListener(evt, cb)`  | Detach. |

`ElementHandle` instances are per-Run. To re-attach listeners after a Run swap, store the `surfaceId` + `elementId` somewhere durable (entity data, for example) and call `scene.getElement(...)` in the next `onScriptLoaded`.

## Sandboxing

User scripts run inside an [SES](https://github.com/endojs/endo) `Compartment`. The realm-bound host APIs the browser usually exposes — `window`, `document`, `fetch`, timers, and so on — are not visible to script code. The only globals available are `Game`, `scene`, and `console`. Scripts that try to import outside of this surface will fail at compile time.

The script's view of the asset catalog is deeply frozen — a buggy or malicious script that holds a reference to a returned `AssetEntry` cannot mutate the host's manifest by writing through it.

Compilation uses TypeScript's `transpileModule` with `module: CommonJS`; the compiled output runs inside the compartment and the default export is captured off a synthetic `exports`. The TypeScript package is dynamically imported the first time you compile, so the cost only lands when you actually script.

## Errors

Errors funnel into a single ring buffer that the script panel renders:

- **Compile errors** show up under source `compile`. The previous Run keeps running.
- **Constructor errors** show up under source `constructor`.
- **Hook errors** show up under their hook name (`onSceneInitialised`, `onScriptLoaded`).
- **Listener errors** show up under `event:<name>`.

The buffer holds the last 10 entries by default. Console output (`console.log`, `console.error`, etc.) goes to the browser's devtools as usual.

## State that survives a save

Two pieces of script state survive a save / load cycle:

- The script source itself (whatever you've **Save Script**-ed; an unsaved Run is in-memory only).
- Each entity's per-entity data map (`entity.setData(key, value)`).

A save also carries the `initialised` flag for the room, so loading a save does not re-fire `onSceneInitialised`. The hook fires once for the lifetime of a room — clicking **Run** repeatedly only re-fires `onScriptLoaded`. Treat `onSceneInitialised` as the one-time room-creation hook and put everything else in `onScriptLoaded`.
