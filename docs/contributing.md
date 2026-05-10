# Contributing

This page is for developers working on the codebase itself. It covers the dev environment, the npm scripts you'll use day to day, where the tests live, and the small handful of conventions worth knowing before adding code.

## Dev setup

```sh
git clone <repo>
cd virtual-table
npm install
npm run dev
```

The client needs Node ≥ 18; the server runs under [Bun](https://bun.sh), which `npm run dev:server` invokes (`bun --watch src/index.ts`). Install Bun separately if you don't already have it.

`npm run dev` runs the client and server concurrently:

- Client at `http://localhost:5173` (Vite dev server, see `packages/client/vite.config.ts`).
- Server at `http://localhost:3001` (Express + ws on Bun, see `packages/server/src/index.ts`).

Override server config via env vars before starting: `PORT`, `MAX_ROOM_PEERS`, `STUN_URLS`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` (defaults in `packages/server/src/config.ts`).

## Scripts

All commands run from the repository root. Workspace-scoped variants live under each package's own `package.json`.

| Command                              | What it does |
|--------------------------------------|--------------|
| `npm run dev`                        | Client + server concurrently. |
| `npm run dev:client`                 | Vite only. |
| `npm run dev:server`                 | Bun signaling server only. |
| `npm run build`                      | `tsc -b && vite build` for the client; `bun build` for the server. Cascades through workspaces. |
| `npm run typecheck`                  | `tsc --noEmit` across both packages. |
| `npm run e2e`                        | Playwright headless run (`packages/client` is brought up automatically — see `playwright.config.ts`). |
| `npm run e2e:ui`                     | Same, with the Playwright UI. |
| `npm test --workspace=packages/client` | Vitest run for the client. |
| `npm run test:watch --workspace=packages/client` | Vitest in watch mode. |

## Test layout

Unit tests are colocated with the source they cover, named `<thing>.test.ts(x)`. Vitest is configured at `packages/client/vite.config.ts` (`test.environment: 'node'`); a few component tests opt into `jsdom` per-file. The server doesn't have its own runner — `signaling.test.ts` uses Bun's built-in test runner via `bun test`.

End-to-end tests live in `e2e/`. Today there is one suite (`e2e/script-editor.spec.ts`) covering the full host + script-editor flow. The Playwright config boots `npm run dev` itself unless a dev process is already running on port 5173; `reuseExistingServer` is on outside CI.

When you add tests:

- Prefer colocated unit tests for a new module — drop a `<name>.test.ts` next to it.
- Use the existing `createInMemoryBusPair` (`packages/client/src/entity/world/InMemoryTransport.ts`) when you need both a host and a guest world inside a single test process. `RtcTransport` requires a real WebRTC stack and is exercised only through the dedicated `RtcTransport.test.ts` and the e2e suite.
- For React components, follow the pattern in `EditorPanel.test.tsx` — `@testing-library/react` + `jsdom`.

## Where things go

A few load-bearing conventions worth following.

### Adding a new component

Components live in `packages/client/src/entity/components/`. A new component class must:

1. Extend `EntityComponent` (`packages/client/src/entity/EntityComponent.ts`) and declare a `static typeId` and `static requires`.
2. Be registered with `componentRegistry.register(...)` somewhere on import — the existing components are registered from the entity-module's barrel, see `packages/client/src/entity/index.ts` and `packages/client/src/entity/spawnables.ts`.
3. Implement `toJSON` / `fromJSON` (or use the helpers) so it round-trips through save/load.
4. If it should be editable from the host's editor inspector, declare a `propertySchema` (see `packages/client/src/entity/propertySchema.ts` for the shape).
5. If it contributes context-menu actions or editor-panel buttons, return them from `getMenuItems` / `getEditorTools`.

Tests for the new component go alongside it as `<name>.test.ts`. The test file pattern in `ZoneComponent.test.ts` and `HandComponent.test.ts` is the cleanest reference — both spin up an in-memory bus pair and assert host/guest state convergence.

### Adding a new spawnable

Register it from `packages/client/src/entity/spawnables.ts` with `registerSpawnable({ type, label, category, defaultTags, components })`. The spawn modal picks it up automatically via `listPublicSpawnables` (`packages/client/src/entity/SpawnableRegistry.ts`). Mark internal-only spawnables (e.g. ones produced by `MergeService` for decks) with `internal: true` to keep them out of the modal.

### Adding a script-facing API

Anything you want a Game script to call needs to land on `SceneFacade`, `EntityFacade`, or `ElementHandle` (in `packages/client/src/scripting/` and `packages/client/src/entity/components/ElementHandle.ts`). Three things to do for each addition:

1. Add the method on the appropriate facade.
2. Add a corresponding declaration to `packages/client/src/scripting/script-globals-types.ts`. This file is the source of truth for the in-editor type information shown in the Monaco script editor.
3. Run `npm run gen:script-globals --workspace=packages/client`. The codegen at `packages/client/scripts/gen-script-globals.ts` reads `script-globals-types.ts` and writes `packages/client/src/scripting/script-globals.dts`. Vite imports the `.dts` as raw text and feeds it to Monaco's `addExtraLib`. The custom extension is deliberate — a real `.d.ts` inside `src/` would be picked up as ambient declarations and silently grant the entire codebase access to a `scene` global, which would mask real bugs.

The generated file is checked in. CI does not regenerate it; if you change the source-of-truth file and forget to run codegen, the editor will stop showing types for your new method.

### Adding a tool

Tools live in `packages/client/src/input/tools/`. A tool implements the `Tool` interface from `types.ts` (`onPress`, `onMove`, `onRelease`, `onCancel`, `hasActiveGesture`, optional `attach`/`detach`). To put it in the toolbar, append a `ToolFactory` entry to `TOOL_CATALOGUE` in `packages/client/src/input/tools/index.ts`. Slot order maps directly to numeric hotkeys.

### Touching the wire format

Scene-channel messages are typed in `packages/client/src/entity/wire.ts`; room-state messages are in `packages/client/src/seats/RoomState.ts`. A breaking change to either message shape needs a coordinated change to both the host emit path (typically `HostReplicatorV2`) and the guest apply path (`World.handleInbound`, `RoomStateClient`). Save-file format changes additionally need `SaveFile.SAVE_VERSION` bumped and `decodeSaveFile` updated to handle older versions if back-compat matters.

## Coding conventions

- TypeScript strict mode is on for both packages. Don't widen with `any` to silence errors; if you genuinely need an escape hatch use a tightly scoped `unknown` cast.
- Functions are small and verbs; classes are nouns. Domain types live with the module that owns them, not in a global types file.
- Comments explain *why*, not *what*. Most existing files lead with a paragraph of intent at the top — a useful pattern to match for new modules.
- Keep React components presentation-only where possible. Cross-cutting state (room state, scene, input) is owned by plain TS classes (`World`, `RoomStateManager`, `InputDispatcher`, etc.) and surfaced to React via refs in `Room.tsx`.
- Tests favor real instances over mocks. The `InMemoryTransport` makes it cheap to wire a real host + guest pair inside one test process; reach for it before reaching for a mock.

## Build outputs

- `packages/client/dist/` — `vite build` output. Static assets only; deploy to any static host.
- `packages/server/dist/` — `bun build` output. Single bundled JS entry point.

The client's `dist/index.html` and `dist/assets/` contain the bundled SPA. The signaling server is a single Bun-targeted binary entry; deploy it anywhere Bun can run.
