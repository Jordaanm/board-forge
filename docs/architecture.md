# Architecture

This document is for developers who want to read or modify the source. It describes how the codebase is laid out, the major sub-systems on the client, the role of the signaling server, and the host/guest authority model that ties everything together. File paths are relative to the repository root.

## Repository layout

This is an npm workspace monorepo with two TypeScript packages plus a small Playwright suite.

```
packages/
  client/          @board-together/client — Vite + React + Three + cannon-es
    src/
      App.tsx                  URL parsing + route to Landing or Room
      ThreeCanvas.tsx          Mounts the WebGL renderer + wires every sub-system
      pages/                   Landing, Room
      components/              All React UI: HostActionBar, EditorPanel, etc.
      entity/                  Entity / component / world / scripting glue
      scripting/               Compiler, Sandbox, Game base, ScriptHost, facades
      net/                     ConnectionManager, SceneState, peer transport
      seats/                   RoomState, RoomStateManager, ownership, layout
      input/                   Tools, dispatchers, drop targets, hotkeys
      camera/                  Orbit camera controller
      cursor/                  Cursor + ping overlays
      scene/                   Table, Skydome, KeyLight, MoveGizmo
      assets/                  Manifest, ManifestStore, AssetService, sounds
      physics/                 PhysicsWorld (cannon-es wrapper)
      dice/                    d6 / d20 face resolution
      card/                    Card orientation
      config/                  Drag and flick tunables
  server/          @board-together/server — Express + ws on Bun
    src/
      app.ts                   HTTP routes + WS upgrade
      index.ts                 Listen on PORT
      signaling.ts             join + offer/answer/ice forwarding
      rooms.ts                 In-memory room registry
      config.ts                Env-driven STUN/TURN config
e2e/                            Playwright integration tests
```

The server is intentionally small — it does signaling, ICE config delivery, and a public list of open rooms. All gameplay state lives on the client, replicated peer-to-peer.

## The client

### Entity / component model

The scene is a flat list of `Entity` instances stored in a per-`World` `SceneImpl`. An entity is a thin data record (`packages/client/src/entity/Entity.ts`) — id, type, name, tags, owner seat, parent / children, a `customData` string map, a per-entity event bus, and a `components` map keyed by typeId.

Entities have no behaviour of their own. Behaviour lives on components, which extend `EntityComponent` (`packages/client/src/entity/EntityComponent.ts`). Each component class declares:

- a `static typeId` (e.g. `'transform'`, `'mesh'`, `'physics'`, `'value'`).
- a `static requires` list of other typeIds it depends on.
- lifecycle hooks: `onSpawn`, `onTick`, `onDespawn`.
- an optional `propertySchema` driving the host's editor inspector (`packages/client/src/entity/propertySchema.ts`).
- optional context-menu and editor-tool contributions.

Spawn order is the topological sort of `static requires`, computed once per typeId set in `ComponentRegistry.getSpawnOrder` (`packages/client/src/entity/ComponentRegistry.ts`). Despawn is the reverse.

Concrete components live in `packages/client/src/entity/components/`. The most central ones:

- `TransformComponent` — owns the entity's `THREE.Object3D` and position/rotation.
- `MeshComponent` — adds geometry to the transform, often by referencing an asset slug.
- `PhysicsComponent` — owns the entity's `CANNON.Body` and bridges it to the transform.
- `ValueComponent` — a per-entity scalar (used by dice for face values, by counters, etc.).
- `SurfaceComponent` — a 2D canvas attached to a face of a 3D piece, hosting `SurfaceElement`s (rich HTML, image, shape).
- `SnapPointsComponent` — a list of local-space poses + radii that act as placement anchors. On grab-drop the host checks every snap point on every entity and teleports the dropped piece onto the closest match (see [hosting.md](./hosting.md) for the user-facing flow). The actual snap algorithm lives in `packages/client/src/entity/snap/snapOnRelease.ts` and is called from `GrabTool` via `HostInputDispatcher`.
- Game pieces: `TableComponent`, `CardComponent`, `DeckComponent`, `DiceComponent`, `ZoneComponent`, `HandComponent`, `FlatViewComponent`, `LightingComponent`, `SkydomeComponent`.

Spawnables are pure-data templates registered with `registerSpawnable` (`packages/client/src/entity/SpawnableRegistry.ts`). Each spawnable lists a type, a label/category for the spawn modal, default tags, and the components it should be built from. The seed list lives in `packages/client/src/entity/spawnables.ts`.

### World

`World` (`packages/client/src/entity/world/World.ts`, exported from `packages/client/src/entity/world/index.ts`) is the runtime that owns one `SceneImpl`, one `PhysicsWorld`, the per-tick stepper, the host/guest replication plumbing, and the `ScriptHost` (host only). It is constructed once per Room and torn down when the room unmounts.

`World.spawn(type, opts)` resolves a spawnable, creates the entity, attaches its components in topological order, and broadcasts to peers (host) or applies an inbound patch (guest). `World.replaceScene(snapshots)` — used by Load and the History modal — wipes and re-creates entities atomically.

Two transports plug into the World:

- `RtcTransport` (`packages/client/src/entity/world/RtcTransport.ts`) wraps `ConnectionManager` for production traffic.
- `InMemoryTransport` (`packages/client/src/entity/world/InMemoryTransport.ts`) provides paired buses for unit tests, so a "host" world and a "guest" world can run inside the same Vitest process.

### Networking

`ConnectionManager` (`packages/client/src/net/ConnectionManager.ts`) is a fairly thin wrapper around `RTCPeerConnection`. It opens a WebSocket to the signaling server, exchanges offer/answer/ICE-candidate messages, and ends up with two `RTCDataChannel`s per peer:

- `'game'` — reliable, ordered. Carries scene mutations, RPC, save/load state, room state.
- `'game-unreliable'` — unordered, no retransmission. Carries position streams (cursor, drag) where dropping a frame is preferable to head-of-line blocking.

ICE servers come from the signaling server's `/ice-config` endpoint (with a public Google STUN fallback). On a host crash or quick reconnect the server's `join` handler evicts the stale host entry, which keeps React StrictMode mount/unmount cycles from leaving zombie hosts behind.

`SceneState` (`packages/client/src/net/SceneState.ts`) defines the wire format for scene-channel messages. The actual scene-replication logic is in `HostReplicatorV2` (host) and the guest-side dispatcher is `World.handleInbound` (`packages/client/src/entity/world/World.ts`). Patches are coalesced per `(channel, typeId, entityId)` so a flood of intra-tick state changes collapses to one wire message per entity per flush.

Room-level state (seats, spectators, host id) lives separately in `RoomStateManager` (host) and `RoomStateClient` (guest), both in `packages/client/src/seats/`. The protocol is an authoritative-snapshot + delta-patch design: when a guest joins, the host pushes a full `room-state` snapshot, then sends `room-state-patch` for any subsequent change.

### Input pipeline

`InputDispatcher` (`packages/client/src/input/InputDispatcher.ts`) is the canvas's pointer-event router. It owns a `ToolDispatcher` (one of `GrabTool`, `PingTool`, `FlickTool`) and an entity raycaster. Pointerdown/move/up are forwarded into the active tool; right-click bypasses the tool stack and goes to `ContextMenuController`.

Local input that produces network effects splits along the host/guest seam:

- `HostInputDispatcher` (`packages/client/src/entity/HostInputDispatcher.ts`) processes inbound RPCs from guests — `hold-claim`, `hold-release`, `request-update`, `apply-impulse`, `play-card-to-table`, etc. — and gates them on `OwnershipPolicy`.
- `GuestInputHandler` (`packages/client/src/input/GuestInputHandler.ts`) handles guest-originated drag-move position streams. Authority for drags comes from `entity.heldBy`, not from per-message gating, so once a guest has claimed a hold, subsequent moves don't need to re-validate.

The lifecycle events surfaced to scripts (`pressed`, `released`, `click`, `hover-start`, `hover-end`, `hover-move`) are defined in `packages/client/src/input/inputEvents.ts` and dual-fired through `World.fireInputEvent` so that host-side listeners observe the same events guests' UIs do.

### Physics

`PhysicsWorld` (`packages/client/src/physics/PhysicsWorld.ts`) wraps a single `cannon-es` `World` with gravity at -9.82 m/s². The simulation runs at a fixed 1/240s step with up to 16 sub-steps per frame, chosen so that the maximum flick velocity (30 m/s) cannot tunnel through the smallest collidable in one step — `cannon-es` has no continuous collision detection, so step size is the only safety net.

Per-entity bodies are owned by `PhysicsComponent`, which mirrors the body's transform onto its sibling `TransformComponent` each tick.

### Scripting host

The scripting subsystem is host-only. Its entry point is `ScriptHost` (`packages/client/src/scripting/ScriptHost.ts`), composed into `World` on host construction.

Pipeline:

1. `Compiler.compileTypescript` (`packages/client/src/scripting/Compiler.ts`) dynamic-imports the TypeScript package and runs `transpileModule` with `ES2022` target + `CommonJS` module emission.
2. `Sandbox.loadModule` (`packages/client/src/scripting/Sandbox.ts`) creates a fresh SES `Compartment`, evaluates the compiled output inside it, and reads the captured default export. The `Game` base class, the `SceneFacade`, and `console` are the only globals injected.
3. `ScriptHost.runScript` instantiates the user's class, tears down the previous Run's listener registrations, and fires `onSceneInitialised` (only the first time for the room) and `onScriptLoaded`.

`SceneFacade` and `EntityFacade` (`packages/client/src/scripting/SceneFacade.ts`, `EntityFacade.ts`) are the script-facing surface — read-mostly wrappers over `SceneImpl` and `Entity` that defensively copy arrays, freeze component state, and route mutations through the existing replication paths.

Errors funnel into `ScriptErrorLog` (`packages/client/src/scripting/ScriptErrorLog.ts`), a bounded ring buffer the script panel subscribes to. Compile, constructor, hook, and listener errors all share the same buffer with a source label.

### Assets

The asset pipeline has three layers:

- `Manifest` (`packages/client/src/assets/Manifest.ts`) is the leaf data type: a list of `AssetEntry` records, each with a slug, type (`image | model | sound | spritesheet`), URL, preload flag, and optional name/description/tags. Spritesheet entries additionally carry `cols` and `rows` (both positive integers, validator-enforced). A spritesheet cell is addressed by a synthetic 3-segment ref (`custom:deck:7`) parsed by `packages/client/src/assets/spriteRef.ts`; UV math (offset/repeat) lives in `packages/client/src/assets/spriteUV.ts`. `AssetService.subscribe` resolves these refs by fetching the parent sheet once and handing each caller a cloned `THREE.Texture` with `offset`/`repeat` set per cell, so consumers stay unaware they're holding a sub-region of a bigger image.
- Three manifests stack at runtime: `BASE_MANIFEST` (placeholder `base:*` slugs), `PRIMITIVE_MANIFEST` (built-in `prim:*` meshes), and the host's `ManifestStore` draft (`packages/client/src/assets/ManifestStore.ts`). Stacks resolve by slug — later manifests can shadow earlier ones.
- `AssetService` (`packages/client/src/assets/AssetService.ts`) is the resolver + cache. Components ask for an asset by slug; the service fetches, parses, and caches it. A CORS preflight (`packages/client/src/assets/corsPreflight.ts`) probes URLs before they're added so the host gets a sensible error in the Asset Manager rather than a broken texture in the scene.

The host's draft is local until **Push to peers** triggers `ManifestStore.push`, which produces a published snapshot and broadcasts it as a `manifest-publish` reliable-channel message. Guests receive the snapshot, replace their published catalog, and rebuild their resolver stack.

`SoundPlayer` (`packages/client/src/assets/SoundPlayer.ts`) wraps `HTMLAudioElement` for one-shot playback used by `scene.playSound`.

## The signaling server

The server lives in `packages/server/` and runs on Bun (`bun --watch src/index.ts`). It does three jobs:

1. **WebSocket signaling** (`packages/server/src/signaling.ts`). Forwards `offer`, `answer`, and `ice-candidate` messages between peers in the same room. Beyond `join` and `leave`, the signaling protocol is opaque to the server — the room-state semantics are entirely a client-side concern.
2. **HTTP `/ice-config`** (`packages/server/src/app.ts`). Returns the configured STUN/TURN servers from `getIceServers()` (`packages/server/src/config.ts`). Configuration is via the `STUN_URLS`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` environment variables, all optional.
3. **HTTP `/rooms`**. Lists open rooms by id and current occupancy so the landing page can show them.

Room membership is held in an in-memory `Map` (`packages/server/src/rooms.ts`). The hard cap is `maxRoomPeers` (default 16, override with `MAX_ROOM_PEERS`). When a host re-joins a room they already hold, the stale entry is evicted — this is what keeps StrictMode and quick reconnects from leaving zombie hosts behind.

## Host vs guest authority

The host is the canonical authority for every piece of room state. Concretely:

- **Scene state** — entity creation, deletion, component patches. Host applies locally then replicates; guest receives and applies. Guest mutations go through RPC (`hold-claim`, `request-update`, `apply-impulse`, etc.) handled by `HostInputDispatcher`, gated on `OwnershipPolicy.canManipulate`.
- **Physics** — only the host steps the simulation. Body positions are streamed to guests via `PhysicsComponent`'s replicator on the unreliable channel; guests apply each update directly to their local transforms.
- **Room state** — the host runs `RoomStateManager`. Guests run a thin `RoomStateClient` that consumes snapshots and patches.
- **Scripting** — only the host has a `ScriptHost`. Guests never see script source. Side effects propagate only through normal replication paths (e.g. `scene.playSound` becomes a `play-sound` broadcast; `entity.setData` becomes an `entity-patch`).
- **Asset catalog** — the host has a writable `ManifestStore` draft. Guests have a published-only view that replaces wholesale on `manifest-publish`.

`OwnershipPolicy.canManipulate` (`packages/client/src/seats/OwnershipPolicy.ts`) is the one place where "may this peer touch this entity?" is decided. It's pure: host can do anything; an unseated peer can do nothing; a seated peer can manipulate unowned entities and entities owned by their own seat. Every host-side input path consults it.

`HoldService` (`packages/client/src/entity/HoldService.ts`) coordinates exclusive holds — when one peer is dragging a piece, no other peer can grab it until the hold is released or the gesture ends. The hold travels with the entity (`entity.heldBy`) and replicates to guests, so visual cues (e.g. the carry lift) appear consistently for everyone.

## Persistence

Save / load is host-only and routes through `SaveFile` (`packages/client/src/entity/SaveFile.ts`). The envelope is a versioned JSON document containing the entity snapshots, the script source + initialised flag, the asset manifest, a thumbnail data URL, and an ISO timestamp. Decode validates the envelope strictly — unknown component typeIds, unknown asset types, and missing required fields all reject before any state lands in the live scene.

`SceneHistoryService` (`packages/client/src/entity/SceneHistoryService.ts`) is a separate undo stack that captures snapshots before host-side mutations. It is independent of save/load; clicking a History entry calls `World.replaceScene` with that entry's snapshot. Critically, history restore does **not** re-Run the script — listeners attached against entities that survive the restore continue to function, and `onScriptLoaded` doesn't re-fire on every undo.
