# SceneController Refactor — Design

Replace the ~50 function refs threaded from `Room.tsx` through `ThreeCanvas.tsx` with a single artifact (`SceneController`) that bundles the scene-modifying API.

## Decisions

### Identity
`SceneController` is **`World` plumbed to React** — not a new class, not a facade.

```ts
// packages/client/src/entity/world/types.ts
export type SceneController = World;
```

React-facing code imports `SceneController`. Engine internals keep `World`.

### Lifecycle
`ThreeCanvas` keeps creating `World` inside its `useEffect` (unchanged). It exposes the world upward via a new callback prop:

```ts
onSceneReady?: (handle: SceneHandle | null) => void;
```

Fires with the handle after world construction; cleanup fires `null`.

`Room.tsx` holds:
```ts
const [handle, setHandle] = useState<SceneHandle | null>(null);
```

### Bundle shape
```ts
export interface SceneHandle {
  controller: SceneController;
  captureThumbnail(): string | null;  // closes over renderer + scene + camera
}
```

`captureThumbnail` lives on the handle (not on `World`) because it's a renderer/view-layer concern. Keeping it off `World` preserves `World` as a pure scene/engine artifact.

### Scope — what collapses
~35 of the ~50 refs become controller calls:
- Scene mutation: `spawn`, `despawn`, `attachSurface`, `attachElement`, `mutateSurfaceElement`, `removeSurfaceElement`, `updateEntityField`, `updateComponentProp`, `roll`, `drawFromDeck`, `shuffleDeck`, `dealFromDeck`
- Hand/drag: `playCardToTable`, `reorderHand`, `fireTileInputEvent`
- Save/load: `saveScene`, `replaceScene`, `sceneHistory`, `onLastLoadedChange`, `onHistoryServiceChange`
- Reads: `getEntity`, `onObjectsChange`
- Scripting: `runScript`, `saveScriptSource`, `getSavedScriptSource`, `loadScriptState`, `onErrorLogChange`
- Peer lifecycle (partial): `onPeerLeft` → `world.releasePeer`

### Out of scope — refs that stay
- **Transport** (`sendRef`, `sendToRef`, `getSelfSeatRef`, `getSelfPeerIdRef`, `getPeerSeatRef`, `onMsgRef`)
- **Tool/selection state** (`onSelect`, `setHighlight`, `setActiveTool`, `getActiveTool`)
- **Camera** (`freeCameraRef`)
- **Manifest** (`getManifestRef`)
- **Debug** (`setShowAllZones`)

These have separate owners (transport, ToolDispatcher, CameraController, ManifestStore). Bundling them would recreate the god-object problem the refactor is escaping.

### Reads / subscriptions
Custom hook wrapping `useEffect` + `useState` + `world.subscribe`:

```ts
function useSceneObjects(controller: SceneController | null, isHost: boolean): ObjectSummary[] {
  const [objects, setObjects] = useState<ObjectSummary[]>([]);
  useEffect(() => {
    if (!controller) return;
    const update = () => setObjects(controller.all().map(h => entityToObjectSummary(h.entity, isHost)));
    update();
    return controller.subscribe(update);
  }, [controller, isHost]);
  return objects;
}
```

Not `useSyncExternalStore` — its tearing-detection requires referentially stable snapshots, which would force memoization inside `World`. Premature for a codebase not using concurrent features.

### Orchestration not on `World`
Three refs do real work in `ThreeCanvas` beyond `world.method()`:

| Ref | New home |
|---|---|
| `onObjectsChangeRef` | `useSceneObjects` hook in Room |
| `saveSceneRef` | `world.snapshot()` + `handle.captureThumbnail()` + `downloadSceneFile(snap, thumb)` util, composed in `HostActionBar` |
| `requestHandTileMenuRef` | Room calls `aggregateContextMenu(controller.get(id), ...)` directly |

`World` does not gain UI-shape methods (`getObjectSummaries`, `exportSceneFile`). Those mix view concerns into the engine.

### Render gating
```tsx
{isHost && handle && (
  <UIPanel anchor="top-left" order={10}>
    <EditorPanel controller={handle.controller} ... />
  </UIPanel>
)}
```

Panel prop types are non-nullable. The brief `null` window during mount/StrictMode-double-invoke is invisible to users (one frame).

### Rollout
**Single PR, big-bang.**

Mechanical edits across `Room.tsx`, `ThreeCanvas.tsx`, and every panel that takes refs (`EditorPanel`, `HostActionBar`, `HandPanel`, `Toolbar`).

Smoke-test before merging:
- Host editing: spawn, delete, edit fields, surface elements
- Save / load round-trip
- Hand drag, play to table, reorder
- Deck draw / shuffle / deal
- Script run + error log
- Guest connection + scene mutations replicating

### Non-React consumers
`ContextMenuController`, `ToolDispatcher`, `InputDispatcher`, `PingOverlay` already receive `World` as a constructor arg from inside `ThreeCanvas`. They keep importing `World` (engine type), not `SceneController` (UI alias). No changes there.

## Future work — not in this refactor
- Consolidate the ~15 non-scene refs into companion artifacts (e.g. `RoomController` for transport/seats, `ToolController` for selection/active tool) — only if they accumulate friction.
- Swap the `SceneController` type alias for a narrowed interface (`interface SceneController { spawn(...); ... }`) if panels start reaching into `world.physics` / `world.transport` / `world.replicator`. No evidence yet.
- Migrate the read hook to `useSyncExternalStore` if/when concurrent rendering features are adopted.
