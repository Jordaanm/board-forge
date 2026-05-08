# Issues — Entity Input Events

Vertical slices derived from `prd--interaction.md`. Each slice is end-to-end demoable.

---

## Issue 1 — InputDispatcher: press / released / click on 3D entities (local-only) ✅

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories:** 1, 2, 3, 6, 11, 12, 13, 14, 16, 17, 18, 22, 24, 29
**Status:** Complete

### What to build

The first tracer bullet for entity input events. Wires a new `InputDispatcher` (sibling to `ToolDispatcher`, owned by `ThreeCanvas`) that subscribes to canvas pointer events, raycasts against `MeshComponent.group` Object3Ds, applies the eligibility filter (not Table, not `isContained`, not foreign-`privateToSeat`), and dispatches `pressed` / `released` / `click` on the topmost-hit entity's `EntityEventBus`. Press-capture pairs `released` to the entity that received `pressed`. `click` fires after `released` iff cursor is still over the captured entity AND travel ≤ 5px AND elapsed < 150ms (matching `GrabTool.MOVE_PX` / `HOLD_MS`). LMB only. No hover events yet. No RPC yet — events fire only on the local bus, so on the host this means scripts can subscribe and see clicks immediately.

A small pure-function `InputEligibility` helper falls out as the eligibility rule, exhaustively unit-tested.

The bus contract from `EntityEventBus` is preserved unchanged. `EntityFacade.addEventListener` already routes through that bus, so script-visible behavior comes for free with the dispatch.

### Acceptance criteria

- [x] `InputDispatcher` constructed in `ThreeCanvas`; disposed on unmount.
- [x] `entity.addEventListener('click', cb)` on a 3D-visible entity fires when the user left-clicks it within thresholds.
- [x] `pressed` fires on pointerdown over an eligible entity; `released` fires on pointerup on the captured entity even if cursor has moved off; `click` fires only when within 5px / 150ms thresholds AND cursor is still over the captured entity.
- [x] Right-click and middle-click do NOT fire any of these events; right-click context menu and middle-click camera control still work.
- [x] Events do NOT fire on entities with `TableComponent`, with `isContained === true`, or with `privateToSeat` set to a seat other than the local viewer's.
- [x] Topmost entity wins; underlying entities do not receive events on the same pointer event.
- [x] Despawning the press-captured entity drops capture silently — no `released`, no `click`.
- [x] `GrabTool` carry continues to work unchanged; a press promoted to a carry produces `pressed` then `released` (no `click`, because thresholds are exceeded) — emergent, not coordinated.
- [x] `InputDispatcher` unit tests pass with fake `PointerEventLike` objects (mirroring `ToolDispatcher.test.ts`):
  - press → release within 150ms / 5px → `pressed`, `released`, `click`
  - press → release after 150ms → `pressed`, `released` (no `click`)
  - press → move > 5px → release → `pressed`, `released` (no `click`)
  - press on A → cursor moves to B → release → `released` on A, no event on B
  - despawn while press-captured → no `released`
  - RMB / MMB pointerdown emits nothing
- [x] `InputEligibility` unit tests cover all five branches (`isContained`, `TableComponent`, `privateToSeat ≠ viewer`, `privateToSeat = viewer`, eligible default).

---

## Issue 2 — InputDispatcher: hover-start / hover-end on 3D entities ✅

**Type:** AFK
**Blocked by:** #1
**User stories:** 4, 5, 15, 23
**Status:** Complete

### What to build

Extends `InputDispatcher` with per-frame hover tracking. On each tick, raycast from the last pointer position against `MeshComponent.group` objects; resolve the topmost eligible entity; emit `hover-start` / `hover-end` on transitions. Per-frame (not pointermove-driven) so events fire correctly when entities move under a stationary cursor — e.g. a thrown die rolls under the pointer.

Hover is suppressed on the entity currently carried by `GrabTool` (so a carried object doesn't self-hover), but other entities still fire normally — this enables drop-target highlight components.

Despawn while hovered drops the hover-target silently — no synthetic `hover-end`. Eligibility flips mid-hover (e.g. `isContained` changes, `privateToSeat` changes) silently re-resolve next frame; no synthetic `hover-end` either.

### Acceptance criteria

- [x] `entity.addEventListener('hover-start', cb)` fires when the cursor moves over the entity.
- [x] `hover-end` fires when the cursor moves off, or onto a different topmost entity.
- [x] Moving an entity under a stationary cursor causes `hover-end` on the old entity and `hover-start` on the new one.
- [x] Carrying entity A with `GrabTool` suppresses hover events on A; entities under the cursor below A still fire normally.
- [x] Despawning the hovered entity drops the hover-target silently — no synthetic `hover-end`.
- [x] Eligibility flips during hover (entity becomes `isContained`, `privateToSeat` changes) silently drop the hover-target next frame — no synthetic `hover-end`.
- [x] Unit tests cover: enter/leave, moving entity under stationary cursor, carry suppression, despawn-while-hovered, eligibility-flip-while-hovered.

---

## Issue 3 — EntityComponent lifecycle hooks ✅

**Type:** AFK
**Blocked by:** #1, #2
**User stories:** 9, 10
**Status:** Complete

### What to build

Extend the `EntityComponent` base class with five new optional lifecycle methods: `onPress`, `onReleased`, `onClick`, `onHoverStart`, `onHoverEnd`. Default implementations in the base class are no-ops; the base class also registers a bus listener at `onSpawn` time that calls the corresponding override. Subclasses override the method, never the registration. Mirrors the existing `onContextMenu` / `onAction` shape.

Teardown follows the existing per-entity bus teardown via `EntityEventBus.clear()` on despawn — no new code path.

A small sample component (e.g. one-line `LogClickComponent` that records clicks for tests) is added to verify the route.

### Acceptance criteria

- [x] `EntityComponent` exposes the five new optional methods with no-op defaults.
- [x] Subclassing and overriding `onClick` causes the method to fire when the entity's bus dispatches `click`, with the same payload.
- [x] Subscriptions are cleaned up by the existing despawn path; no leaks across spawn / despawn cycles.
- [x] Component-side consumer test: subclass `EntityComponent` overriding `onClick`, spawn the entity, dispatch `click` on its bus, assert the override was called with the payload. (Light end-to-end; really retesting that the route registers.)
- [x] Existing components (`MeshComponent`, `ZoneComponent`, etc.) continue to work unchanged.

---

## Issue 4 — Dual-fire RPC: `guest-input-event` variant + host re-fire

**Type:** AFK
**Blocked by:** #1, #2
**User stories:** 7, 8, 26, 27, 28

### What to build

Adds the dual-fire half of the design: every event a peer dispatches locally is ALSO RPC'd to host, where the host's per-entity bus re-fires it. This makes host-only scripts authoritative observers of every peer's input.

Adds a new `GuestInputMessage` variant: `{ type: 'guest-input-event'; entityId: string; eventName: InputEventName; payload: InputEventPayload }`. `InputDispatcher.fireInputEvent(entity, eventName, payload)` becomes the single dual-fire entry point — local dispatch first, then RPC. On the host, the inbound router validates that the entity exists and that the sender's seat matches `payload.seat`, then re-fires on the host's per-entity bus.

No throttling. Hover transitions are sparse; press / release / click are user-rate.

### Acceptance criteria

- [ ] `GuestInputMessage` discriminated union has the new variant; existing `guest-drag-*` variants unchanged.
- [ ] All five event types use `fireInputEvent` for dispatch; local bus fires before the RPC is sent.
- [ ] Host receives `guest-input-event` and re-fires on the named entity's bus when the sender's seat matches `payload.seat` and the entity exists.
- [ ] Host rejects (silently, no host-side fire) when sender's seat does not match `payload.seat` or `entityId` is unknown.
- [ ] Guest-originated events fire on the LOCAL guest's bus instantly (no host round-trip required for local components or scripts on that peer).
- [ ] Dual-fire / RPC integration test (mirroring `RtcTransport.test.ts`):
  - guest fires `click` locally → emits `guest-input-event` over transport → host re-fires on the per-entity bus with the originating seat in the payload
  - sender seat mismatch → host rejects
  - unknown `entityId` → host rejects

---

## Issue 5 — HandPanel: FlatView press / released / click on tiles

**Type:** AFK
**Blocked by:** #4
**User stories:** 19, 21, 25

### What to build

Extends `HandPanel` to dispatch `pressed` / `released` / `click` on tile pointerdown / pointerup, gated on the same 5px / 150ms thresholds. Routes through `InputDispatcher.fireInputEvent` so dual-fire works identically to 3D-originated events. Payload omits `worldHit` (no 3D coords for a 2D tile) — script code uses `if (e.worldHit)` as a 3D / 2D discriminant.

The existing tile click → select behavior, right-click → context menu, and pointerdown-drag-out → play-card-to-table all stay unchanged. The new events are additive.

### Acceptance criteria

- [ ] Clicking a hand tile fires `pressed` and `click` (and a same-tile pointerup also fires `released`) on the corresponding entity's bus, with `worldHit` absent from the payload.
- [ ] Tile pointerdown then drag away from the panel fires `pressed` then `released` (no `click`, because the threshold is exceeded) — and the existing `playCardToTable` flow still triggers.
- [ ] Modifier keys (`shiftKey`, `ctrlKey`, `altKey`) and `seat` are populated correctly in the payload.
- [ ] Existing tile click → select behavior still works; existing right-click → context menu still works; existing reorder / play-to-table still works.
- [ ] Events dual-fire — host receives `guest-input-event` for FlatView-originated tile clicks from a guest peer.
- [ ] HandPanel unit tests cover: pressed-released-click within thresholds, pressed-released only when over threshold, modifier keys propagated, `worldHit` absent.

---

## Issue 6 — HandPanel: FlatView hover-start / hover-end on tiles

**Type:** AFK
**Blocked by:** #5
**User stories:** 20

### What to build

Adds `hover-start` / `hover-end` dispatch on tile mouseenter / mouseleave (or pointerenter / pointerleave). Routes through `InputDispatcher.fireInputEvent`. CSS hover (the existing visual highlight) stays unchanged — these events are additive and do not replace any styling behavior.

### Acceptance criteria

- [ ] Mousing over a hand tile fires `hover-start` on the corresponding entity's bus.
- [ ] Mousing off (or onto a different tile) fires `hover-end` on the previously-hovered entity's bus.
- [ ] Payload omits `worldHit`.
- [ ] Events dual-fire — host receives `guest-input-event` for FlatView hover transitions from a guest peer.
- [ ] Existing CSS / visual hover behavior on tiles is unchanged.
- [ ] HandPanel unit test covers: hover transitions across tiles fire `hover-end` on the old, `hover-start` on the new.
