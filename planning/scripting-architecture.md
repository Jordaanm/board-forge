# Custom Scripting Architecture

## Overview

Scripts allow game authors to define custom behavior on top of the physics sandbox. The scripting system is built around a `Game` base class that authors subclass, with lifecycle hooks for scene setup and player events.

## Execution Model

- Scripts execute **on the host only**
- Clients receive state changes via the existing sync protocol, not by running scripts
- Some scene object methods are inherently replicated (e.g. `playSound`) — calling them on the host broadcasts the effect to all clients

## Script Contract

A game script is a single JavaScript module with a default export that extends `Game`:

```js
export default class MyGame extends Game {
  onSceneInitialised(scene) { ... }
}
```

The runtime loads the script into an SES Compartment, reads the default export, asserts it extends `Game`, and instantiates it.

## Lifecycle Hooks

| Hook | Payload | Purpose |
|---|---|---|
| `onSceneInitialised(scene)` | Scene reference | Main setup — wire event listeners, clone templates, etc. |
| `onPlayerJoined(player)` | Player reference | React to new players joining |
| `onPlayerLeft(player)` | Player reference | Handle mid-game disconnects |
| `onPlayerChangedSeat(player, seat)` | Player + seat | Track which user is acting as which board game player |
| `onGameReset()` | — | Called when the host reloads the same game |

## Scene API

Scripts interact with the scene through a `scene` global provided by the runtime:

```js
// Query objects
scene.getObjectById(guid)
scene.getObjectsByTag(tag)

// Spawn objects by cloning hidden templates
scene.clone(objectReference)
scene.cloneFromGUID(guid)

// Scheduling (no browser globals exposed)
scene.scheduleAfter(seconds, callback)
scene.scheduleRepeating(interval, callback)
```

## Event Listeners

DOM-style event listeners on scene objects:

```js
pawn.addEventListener("collision", (event) => {
  const { target, other } = event; // object references in payload
});
```
## Scene Objects

The scene is fundamentally a physics sandbox, with the contents represented by a scene graph of objects.

Objects are entities that can be queried, cloned, and modified.
Object do not own executable code, but are instead a collection of properties and methods that can be called by scripts.

Each object has at a minimum:
- A GUID
- A transform (position, rotation, scale)
- A type (e.g. "pawn", "wall", "floor")
- a set of tags
- a custom data map (Map<string, string>)

Additional properties are granted by way of components added to the object.

For example, Container components add a `children` property, which is a list of child object GUIDs.
So, if we say that a Deck has a Container component, we can access the cards in the deck via 'deck.getComponent<Container>().children';

## Object Identity

All scene objects have a GUID. Scripts can:
- Query by GUID via `scene.getObjectById(guid)`
- Receive object references directly in event payloads

## Dynamic Spawning

Objects are spawned by cloning existing scene objects. The recommended pattern is to place hidden "template" objects in the scene during editing, then clone them at runtime:

```js
onSceneInitialised(scene) {
  this.queenTemplate = scene.getObjectById("template-queen");
}

// later...
const newQueen = scene.clone(this.queenTemplate);
```

Cloned objects receive a fresh GUID. A discrete "object spawned" message is sent to all clients so they can allocate and render the new object.

## Game Loading Sequence

1. Host requests a game load (explicit user action)
2. Scene graph loads from server
3. Clients receive a "scene reset" message, then a full state snapshot
4. Script is fetched from server and executed in a fresh SES Compartment
5. `onSceneInitialised(scene)` is called

The room persists across game loads — players stay connected as the host switches games.

## Sandboxing

Scripts run in an SES Compartment with an explicit allowlist:
- `scene` — the scene API
- `Game` — the base class to extend
- `console` — for author debugging

No browser globals (`window`, `setTimeout`, `setInterval`, `fetch`, etc.) are accessible.

Script loading is gated behind an explicit host action — it never happens automatically.

## Error Handling

| Context | Behavior |
|---|---|
| `onSceneInitialised` throws | Session continues as plain physics sandbox; host receives stack trace; all players receive a human-readable error notice |
| Runtime event handler throws | Error is caught per-invocation; host receives stack trace; players receive notice; scripting continues for subsequent events |

Errors are never fatal to the session. The physics sandbox always remains playable.

## TypeScript Authoring

Scripts are authored in TypeScript and stored as `.ts` source on the server. Compilation to JS happens in the browser at game-load time — there is no server-side build step.

### Compilation

Use `ts.transpileModule` from the `typescript` package. It is a single-file, type-strip-only transpiler — no type checking, no import resolution — which matches the single-file script contract exactly.

```ts
import ts from 'typescript';

function compileScript(tsSource: string): string {
  const result = ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return result.outputText;
}
```

The `typescript` package is ~3MB and should be lazy-loaded only when the host triggers a game load.

### Load Sequence (revised)

1. Host requests a game load
2. Scene graph loads from server
3. Clients receive "scene reset" + full state snapshot
4. Host fetches `.ts` source from server
5. Host compiles `.ts` → JS string via `ts.transpileModule`
6. Compiled JS is loaded into a fresh SES Compartment using the **module compartment** API (not `evaluate()`) so that the `export default class MyGame` syntax is valid
7. `onSceneInitialised(scene)` is called

### Post-PoC upgrade path

If multi-file scripts are added later, replace `ts.transpileModule` with `esbuild-wasm` (a ~7MB WASM bundle), which supports bundling and is significantly faster.

## Deferred / Post-PoC

- Multiple script files / module imports
- Error rate limiting (disable scripting after N consecutive failures)
- Host migration (session currently ends when host disconnects)
- Typed event interfaces for TypeScript authors
