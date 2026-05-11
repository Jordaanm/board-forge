# Issues — Snap Points

Source: [prd--snap.md](./prd--snap.md)

Five vertical slices. Build in dependency order. Each slice is independently grabbable once its blockers land.

---

## Issue 1 — Snap-resolution pure module

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 14, 17, 18, 19, 32

### What to build

One pure module with unit tests, no integration. Single source of truth for the snap-decision algorithm; consumed by the GrabTool integration in slice #3.

- `resolveSnap.ts` — pure module exporting `resolveSnap(input)` → `SnapResult | null` where:
  - `input` is `{ droppedXZ: [number, number]; droppedEntityId: string; descendantIds: Set<string>; candidates: SnapCandidate[] }`
  - `SnapCandidate` is `{ ownerEntityId: string; worldPos: [number, number, number]; worldYaw: number; snapRotation: boolean; radius: number }` (each candidate is already-resolved-to-world by the caller)
  - `SnapResult` is `{ targetPos: [number, number, number]; targetYaw: number; snapRotation: boolean }`
  - No I/O, no THREE dependency beyond plain numeric vectors, no scene access.
- Distance metric: XZ-only. `sqrt(dx² + dz²) <= candidate.radius`.
- Self-exclusion: any candidate whose `ownerEntityId === droppedEntityId` or is in `descendantIds` is filtered out before tie-breaking.
- Tie-breaking: smallest XZ distance wins; deterministic on equal distance (input order stable).
- `targetPos[1]` (Y) comes from candidate world Y, not the dropped entity.

### Acceptance criteria

- [x] No candidates → returns `null`
- [x] Single candidate inside radius → wins; result fields match candidate
- [x] Single candidate outside radius → returns `null`
- [x] Multiple candidates inside radius → closest XZ wins
- [x] Tied distances → deterministic outcome (document the tiebreak rule and assert it)
- [x] Candidate owned by `droppedEntityId` is excluded
- [x] Candidate owned by an entity in `descendantIds` is excluded
- [x] XZ-only: a candidate at large Y delta but small XZ delta is still a hit; a candidate at small Y delta but XZ outside radius is a miss
- [x] `snapRotation` flag passes through to the result unchanged
- [x] `targetPos.y` equals candidate world Y regardless of dropped entity Y
- [x] Unit tests at the module's API boundary — feed inputs, assert outputs, no internal-state inspection

**Status:** Complete.

### Blocked by

None — can start immediately.

---

## Issue 2 — SnapPointsComponent + SnapMarker + visualization + host toggle

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1, 2, 3, 4, 5, 9, 10, 20, 22, 23, 24, 25, 26, 27, 28

### What to build

The full entity-side stack so the host can spawn a SnapMarker, see it on screen, grab it, and have it replicate. No snap-on-drop behavior yet — that's slice #3. No editor numeric form yet — that's slice #4 (the default snap point is sufficient for now).

- `SnapPointsComponent` registers in `ComponentRegistry` with typeId `snap-points`.
  - State shape `{ points: SnapPoint[] }` where `SnapPoint` is `{ id: string; localPos: [number, number, number]; localYaw: number; snapRotation: boolean; radius: number }`
  - Implements `toJSON` / `fromJSON` / `applyRemoteState` per the existing component contract
  - Replication on the **reliable** channel (`static channel = 'reliable'`)
  - Static `showAll: boolean = false` flag with a setter that walks live instances and toggles the visualization group's `visible` property
- Visualization (owned by `SnapPointsComponent`):
  - Per-point THREE.Group containing a translucent green disc (radius = point radius, lying horizontally) + a forward arrow along +Z rotated by `localYaw` when `snapRotation` is true
  - `depthWrite: false`. Non-raycastable for non-marker entities. Attached as a child of the parent's `TransformComponent` group so parent motion carries it.
  - `visible = false` by default; flipped by `showAll` setter. Zero per-frame cost when hidden.
  - Rebuilds when `points` array changes (state-driven, no per-frame walk).
- `SnapMarker` spawnable registers in `spawnables.ts`:
  - Components: `TransformComponent` + `SnapPointsComponent` (one default point `{ id: <uuid>, localPos: [0,0,0], localYaw: 0, snapRotation: false, radius: <sensible-default> }`)
  - No `MeshComponent`, no `PhysicsComponent`
  - Default tags `['snap-marker']`
  - Marker IS grabbable when visualization is shown — its disc participates in raycast (separate from the non-raycastable visualization on regular entities)
- `HostActionBar` adds a **Show Snap Points** checkbox mirroring the existing **Show All Zones** wiring:
  - `setShowSnapPointsRef.current` setter installed in `ThreeCanvas` alongside `setShowAllZonesRef.current`
  - Toggle invokes the setter which flips `SnapPointsComponent.showAll`
  - On unmount, reset to `false` like `ZoneComponent.showAllZones`
- Guest behavior: SnapMarker entities replicate via normal entity-spawn path; guests carry the component state but their visualization stays hidden (`showAll` is host-only host-state — guests never set it true). `SnapMarker` raycast on guests is effectively disabled because the disc is invisible.

### Acceptance criteria

- [ ] Component registers, serializes, and round-trips through `toJSON` / `fromJSON` / `applyRemoteState` (unit tests on the component, following the `ZoneComponent.test.ts` boundary discipline)
- [ ] `SnapPointsComponent.showAll = true` flips all live instances' visualization visible; `= false` flips them invisible
- [ ] Toggle in HostActionBar drives `showAll`; unmount resets to `false`
- [ ] Spawning a SnapMarker via the existing host spawn UI creates an entity with `Transform` + `SnapPoints` only (no mesh, no physics)
- [ ] With **Show Snap Points** on: marker shows the disc; `snapRotation: false` default → no arrow
- [ ] With **Show Snap Points** off: marker fully invisible; cannot be grabbed (raycast misses)
- [ ] Host drags the marker with the existing GrabTool — marker moves; visualization follows because it's a child of the TransformComponent group
- [ ] Save → reload preserves SnapMarker entities and SnapPointsComponent state (existing save envelope handles this without modification — verify with a manual smoke test)
- [ ] Guest in a second window receives the SnapMarker entity through the existing replication path; guest's visualization stays hidden regardless
- [ ] No regression in existing `Show All Zones` behavior or component registration

### Blocked by

None — can start immediately.

---

## Issue 3 — GrabTool drop snap integration

**Type:** AFK
**Blocked by:** #1, #2
**User stories covered:** 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 29, 30, 31

### What to build

Hook the snap-resolution module (#1) into the host's GrabTool release path so dropping a carried object near a snap point teleports it onto the point.

- At the release site in `GrabTool` on the host, **before** the existing throw-velocity application:
  1. Gather all `SnapPointsComponent` instances in the scene
  2. For each point, compute world pos and world yaw via the owning entity's `TransformComponent`
  3. Build the `SnapCandidate[]` input for `resolveSnap`
  4. Compute the dropped entity's descendant-set via existing scene-graph traversal
  5. Call `resolveSnap(...)` from #1
- On a hit:
  - Set the dropped entity's position to `result.targetPos`
  - If `result.snapRotation` is true, set yaw to `result.targetYaw`; otherwise preserve current rotation
  - Zero the entity's linear and angular velocity on its `CANNON.Body`
  - Skip throw velocity entirely
- On a miss:
  - Continue with existing release behavior unchanged (throw velocity from velocity history, drop-target dispatch, etc.)
- Guest-initiated drops: no GrabTool change. Guest's existing release RPC already routes through the host; the host runs the snap check exactly as above and broadcasts the final pose via the normal `TransformComponent` patch.
- Negative cases (assert NOT triggered):
  - Scripted `setPosition` on an entity — no snap
  - State load / scene snapshot apply — no snap
  - Initial entity spawn — no snap

### Acceptance criteria

- [ ] Host drops a carried object near a SnapMarker (within the marker's snap-point radius in XZ) → object teleports to the marker's snap-point world pos; linear and angular velocity zeroed
- [ ] Default SnapMarker point has `snapRotation: false` → dropped object's rotation is preserved on snap
- [ ] Set `snapRotation: true` on the marker's point (via direct state edit for now; editor UX lands in #4) and drop again → dropped object's yaw is set to the point's world yaw
- [ ] Drop away from any marker → existing throw / physics behavior unchanged
- [ ] Two markers near each other, drop between them → closest in XZ wins
- [ ] Drop the SnapMarker itself near another marker → the moving marker's own snap point is excluded from candidates; if the other marker is within its own radius, the moving marker snaps to the other one (consistent universal rule; no special-casing)
- [ ] Guest releases a carried object near a host's SnapMarker → object snaps the same way (host runs the check; result reaches guest as a normal TransformComponent patch)
- [ ] Scripted `entity.transform.setPosition(...)` to a position inside a snap radius does **not** trigger snap
- [ ] Loading a save with entities placed inside snap radii does **not** trigger snap
- [ ] Initial scene spawn does **not** trigger snap
- [ ] No new keybind, no UI affordance — snap is automatic on release

### Blocked by

- Blocked by #1
- Blocked by #2

---

## Issue 4 — Host editor numeric form for snap points

**Type:** AFK
**Blocked by:** #2
**User stories covered:** 6, 7, 8

### What to build

Add the numeric-form editor UX so the host can add, edit, and delete snap points on any entity carrying a `SnapPointsComponent` — including SnapMarker instances and regular entities (e.g. a card).

- `SnapPointsComponent.onEditorTools(ctx)` returns the per-point rows for the editor panel:
  - Heading: "Snap Points"
  - One row per point, each with: x / y / z / yaw / radius number inputs, `snapRotation` checkbox, delete button (button id encodes the point id)
  - "Add Snap Point" button at the bottom — appends `{ id: <uuid>, localPos: [0,0,0], localYaw: 0, snapRotation: false, radius: <default> }`
- `SnapPointsComponent.onAction(actionId, args, ctx)` handles add / delete / per-field updates and calls `setState({ points: ... })` to fire a reliable patch.
- Edits replicate to guests on the reliable channel (existing path, no new wire).
- Visualization (#2) updates when `points` changes — adding a point spawns its disc/arrow, deleting removes the mesh, editing a value moves/resizes the disc in place.

### Acceptance criteria

- [ ] With **Show Snap Points** on and a SnapMarker selected, the editor panel shows the "Snap Points" section with the marker's default point listed and editable
- [ ] Clicking "Add Snap Point" appends a new point at origin; visualization disc appears
- [ ] Editing x/y/z/yaw/radius updates the point and the visualization in place
- [ ] Toggling `snapRotation` adds/removes the forward arrow
- [ ] Deleting a point removes both state and visualization
- [ ] Editor flow works on regular entities too — manually attach a `SnapPointsComponent` to a card (via dev console or direct state edit), open the card in the editor panel, configure 4 edge points, drop a second card near the first card's right edge → second card snaps to the first card's edge point (validates the row-of-cards use case manually; built-in defaults remain out of scope per the PRD)
- [ ] Edits replicate to guests over the reliable channel (verify by inspecting state on a second window)

### Blocked by

- Blocked by #2

---

## Issue 5 — End-to-end smoke test

**Type:** HITL
**Blocked by:** #3, #4
**User stories covered:** verification of replication, save/load, multi-host/guest, "row of cards" manual flow

### What to build

Manual verification of the motivating flow. No code — this issue exists to record the test plan and capture results.

Flow:
1. Start a fresh room as host. Toggle **Show Snap Points** on.
2. Spawn a SnapMarker via the existing host spawn UI. Grab and drag it to a position on the table.
3. Open the marker in the editor panel. Set `snapRotation: true` and `localYaw: 0`. Set radius to a clearly visible value.
4. Spawn a Card. Drag the card to a position outside the marker's radius and release — verify it falls and lands normally.
5. Drag the card and release inside the marker's radius — verify the card teleports to the marker's position and yaw, velocity zeroed.
6. Toggle **Show Snap Points** off — marker disappears; card stays put.
7. Toggle back on — marker reappears at the same spot.
8. Save the room. Reload. Verify the SnapMarker and the card's snapped position both persist.
9. Open a second browser window as a guest. Verify the guest does NOT see the SnapMarker visualization (toggle is host-only). Drag a card on the guest side and release near the marker — verify the card still snaps (host-authoritative).
10. **Row of cards manual flow:** Attach a `SnapPointsComponent` to a card via the editor panel. Add 4 edge points (radius small enough to require near alignment; localYaw matching card yaw for `snapRotation: true`). Spawn a second card. Drag it near the first card's right edge → verify the second card snaps to the edge point. Drag a third card near the second card's right edge → verify chaining works.
11. **Scripted-move negative test:** From a script, call `setPosition` on an entity moving it into a snap radius — verify no snap occurs.

### Acceptance criteria

- [ ] Host spawn → drag → edit SnapMarker round-trips cleanly
- [ ] Card snaps to marker (position + yaw) with velocity zeroed
- [ ] Card outside radius behaves as before (throw + physics)
- [ ] Toggle hides/shows marker; no rendering cost when off (visual eye-check)
- [ ] Save → reload preserves marker entity and snapped card pose
- [ ] Guest does not see marker visualization; guest drops still snap (host-authoritative)
- [ ] Row-of-cards chaining works with manually-configured edge points
- [ ] Scripted `setPosition` into a snap radius does not snap

### Blocked by

- Blocked by #3
- Blocked by #4
