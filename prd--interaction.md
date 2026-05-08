# PRD: Entity Input Events (pressed / released / click / hover-start / hover-end)

## Problem Statement

As a script author, I want to react to user clicks and hovers on entities — for game logic (button-on-table, hover-tooltip, drag-onto-target highlights) and for sibling components to drive their own behavior. Today scripts can only observe domain events like `value-changed`; raw input is owned by `GrabTool` and `ContextMenuController` with no extension hook. The same gap blocks components like a hypothetical `ButtonComponent` or hover-highlight.

## Solution

Five kebab-case events on the existing per-entity `EntityEventBus`:
`pressed`, `released`, `click`, `hover-start`, `hover-end`.

Both user scripts (via `EntityFacade.addEventListener`) and sibling components (via new `EntityComponent` lifecycle methods that internally subscribe) consume them. Tools keep their existing raycasts unchanged — the new events are a **parallel observer** of the same input.

A new `InputDispatcher` (sibling to `ToolDispatcher`, owned by `ThreeCanvas`) is the single source of all five events. It raycasts per frame for hover, pairs press→release→click with capture, applies eligibility filters, and dual-fires (local + host RPC) so host scripts see every peer's input.

## User Stories

1. As a script author, I want `entity.addEventListener('click', cb)` to fire when a player left-clicks the entity, so I can build a button-on-the-table.
2. As a script author, I want `pressed` and `released` separately so I can implement press-and-hold gestures.
3. As a script author, I want `click` suppressed when the press is promoted into a `GrabTool` carry, so a quick-tap-to-flip card doesn't double-fire when the player drags it.
4. As a script author, I want `hover-start` / `hover-end` so I can build a tooltip or a highlight that follows the cursor.
5. As a script author, I want hover events to fire when an entity moves under a stationary cursor (e.g. a thrown die rolls under the pointer), so my tooltip stays accurate without a forced pointermove.
6. As a script author, I want the event payload to include `seat`, `shiftKey`, `ctrlKey`, `altKey` and (for 3D-originated events) `worldHit`, so I can distinguish modifier-clicks and resolve the click point on the surface.
7. As a script author, I want the host's bus to fire the event regardless of which peer's pointer caused it, so my host-only scripts are authoritative observers of all input.
8. As a guest player, I want the local hover/highlight to react instantly without a host round-trip, so feedback feels snappy.
9. As a component author (e.g. `HoverHighlightComponent`), I want to override `onPress` / `onClick` / `onHoverStart` / `onHoverEnd` / `onReleased` on `EntityComponent`, so I can build component-level behavior without manual `addEventListener` boilerplate.
10. As a component author, I want the lifecycle hooks to internally route through the same per-entity bus, so component subscriptions and script subscriptions share one dispatch path and one teardown path.
11. As a script author, I want events to fire only on the topmost entity under the cursor, so underlying entities don't get spurious events.
12. As a player, I do NOT want events firing on the Table — right-click context menu and middle-click camera control must continue to work, and Table is treated as empty space.
13. As a player, I do NOT want events firing on entities I cannot see (`privateToSeat` belongs to another seat), so the input surface matches the visual surface — anti-cheat consistency.
14. As a player, I do NOT want events firing on entities that are `isContained` (mesh hidden / tile not rendered).
15. As a player carrying an entity, I do NOT want hover events firing on the carried entity itself (it's pinned to my cursor), but I DO want hover events on other entities under the cursor (e.g. drop-target preview).
16. As a player, I want only LMB to trigger these events. RMB stays bound to the context menu; MMB stays with the camera controller.
17. As a script author, I want `released` to fire on the entity that received `pressed` even if the cursor has since left it, so capture works the way users expect.
18. As a script author, I want `click` to fire iff the cursor is still over the captured entity AND total pointer travel ≤ 5px AND elapsed < 150ms (matching `GrabTool.MOVE_PX` / `HOLD_MS`), so click semantics align with grab semantics.
19. As a script author, I want `pressed` and `click` events on hand-panel tiles (FlatView), so my scripts can react to a card click whether the card is on the table or in the hand.
20. As a script author, I want `hover-start` / `hover-end` events on hand-panel tiles too, so a tooltip component works identically for 3D and 2D representations.
21. As a script author, I want `worldHit` absent on FlatView-originated events (no 3D coords for a 2D tile), so my code can detect the origin reliably.
22. As a player, when an entity is despawned while it's the press-capture target, I do NOT want a `released` event — capture is dropped silently.
23. As a player, when an entity is despawned while it's the hovered target, I do NOT want a synthetic `hover-end` — natural pointer transitions only. Scripts handle teardown via existing despawn hooks.
24. As a script author, I want a thrown listener to be isolated — it must not abort other listeners for the same dispatch (existing bus contract).
25. As a script author, I want my listener registrations to be torn down when a Run ends, just like every other `addEventListener` call (existing `EntityFacade` per-Run tracking).
26. As a host, I want a guest's `pressed` to RPC to me with the originating peer's seat in the payload, so script logic that gates on seat works.
27. As a host, I do NOT want hover-event RPC traffic to swamp the network — hover fires only on **transitions**, so no extra throttling is needed; press/release/click are bounded by user input rate.
28. As a player on a peer, I want hover, press, release, and click to ALL fire locally on my own bus before the host sees them (dual-fire), so local components react without a round-trip.
29. As a tool author (`GrabTool`, future tools), I want the new events to fire **in parallel** with my tool's gesture detection — both observe the same input, neither blocks the other. A promoted carry naturally suppresses `click` via the threshold check; no manual coordination.

## Implementation Decisions

### Modules to build / modify

- **`InputDispatcher`** — new module, sibling to `ToolDispatcher`, owned by `ThreeCanvas`. Single source of all five events.
  - Subscribes to `pointerdown` / `pointermove` / `pointerup` on the canvas.
  - Per-frame raycast against `MeshComponent.group` Object3Ds; recovers entity via `world.pickByObject3D`.
  - Tracks topmost-hovered entity; emits `hover-start` / `hover-end` on transitions, including transitions caused by entities moving under a stationary cursor.
  - Owns press-capture state. `pointerup` always fires `released` on the captured entity (regardless of cursor position). `click` fires after `released` iff cursor is still over capture target AND travel ≤ 5px AND elapsed < 150ms.
  - Drops capture silently when the captured entity despawns (no `released`).
  - Exposes `fireInputEvent(entity, eventName, payload)` — the single dual-fire entry point. Local dispatch + host RPC.

- **`InputEligibility`** — pure helper, separable for testing. Returns true iff entity is eligible to receive input events. False when:
  - `entity.isContained === true`
  - entity has `TableComponent`
  - `entity.privateToSeat` is set and not equal to the local viewer's seat

- **`EntityComponent`** — extend with five new optional lifecycle methods: `onPress`, `onReleased`, `onClick`, `onHoverStart`, `onHoverEnd`. Default impl in the base class registers a bus listener at `onSpawn` time that calls the override; subclasses override the method, not the registration. Mirrors the existing `onContextMenu` / `onAction` shape.

- **`HandPanel`** — extend to dispatch FlatView-originated events:
  - `pressed` / `released` / `click` on tile pointerdown / pointerup, gated on the same 5px / 150ms thresholds.
  - `hover-start` / `hover-end` on tile mouseenter / mouseleave (CSS hover stays unchanged).
  - Routes through `InputDispatcher.fireInputEvent`. Payload omits `worldHit`.

- **`GuestInputMessage`** (in `net/SceneState.ts`) — new variant: `{ type: 'guest-input-event'; entityId; eventName; payload }`. Existing `guest-drag-*` variants unchanged.

- **`World` / host inbound router** — handle `guest-input-event`: validate the entity exists and the sender's seat matches the payload's `seat`; on success, re-fire the event on the host's per-entity bus.

### Interfaces

```
type InputEventName = 'pressed' | 'released' | 'click' | 'hover-start' | 'hover-end';

interface InputEventPayload {
  seat:      SeatIndex | null;
  shiftKey:  boolean;
  ctrlKey:   boolean;
  altKey:    boolean;
  worldHit?: { x: number; y: number; z: number };
}
```

### Key architectural decisions

- **Single owner of all five events.** `InputDispatcher` is the only place that emits them; `HandPanel` calls `fireInputEvent` but does not own state.
- **Parallel observer of input.** Tool gestures and these events both fire independently. No tool changes; no event-suppression matrix.
- **Topmost hit only.** Closest intersect wins per pointer event.
- **Hover suppression on carried entity only.** Other entities still fire normally — useful for drop-target highlights.
- **No throttling on dual-fire.** Hover transitions are sparse; press/release/click are user-rate.
- **`MeshComponent` and `FlatViewComponent` unchanged.** `MeshComponent` already exposes `group`; `FlatViewComponent` stays a pure data marker. Picking happens at the call site.
- **Eligibility evaluated per dispatch attempt.** A mid-hover privacy change or `isContained` flip silently drops the next raycast result; no synthetic `hover-end` is fired (only natural pointer transitions trigger hover-end).
- **EntityEventBus contract preserved.** Listener exceptions isolated; teardown via `EntityEventBus.clear()` on despawn; `EntityFacade` per-Run registration tracking unchanged.

### Despawn / capture loss behavior

- Despawn while hovered → silently drop hover-target. No synthetic `hover-end`.
- Despawn while press-captured → silently drop capture. No `released`, no `click`.
- Tools (`GrabTool` etc.) are NOT consumers of these events — they keep their existing raycasting.

## Testing Decisions

Test external observable behavior, not internal data structures. Tests assert what scripts and components see on the bus, not the InputDispatcher's private state.

### Modules under test

- **`InputDispatcher`** — unit tests with fake `PointerEvent`-like objects (mirroring the `ToolDispatcher.test.ts` `PointerEventLike` pattern, no DOM env required):
  - press → release within 150ms / 5px → fires `pressed`, `released`, `click` in order
  - press → release after 150ms → fires `pressed`, `released` only (no `click`)
  - press → move > 5px → release → fires `pressed`, `released` only
  - press on entity A → cursor moves to entity B → release → `released` fires on A (capture), no event on B
  - hover transitions: cursor enters / leaves → `hover-start` / `hover-end` on the right entity
  - moving entity under stationary cursor: per-frame raycast change → `hover-end` on old, `hover-start` on new
  - carry suppression: GrabTool carry on entity A → no hover events on A; other entities still fire
  - despawn while press-captured → no `released`
  - despawn while hovered → no synthetic `hover-end`
  - LMB only — RMB / MMB pointerdown emits nothing

- **`InputEligibility`** — pure-function tests:
  - `isContained` → ineligible
  - has `TableComponent` → ineligible
  - `privateToSeat = 2`, viewer seat = 1 → ineligible
  - `privateToSeat = 2`, viewer seat = 2 → eligible
  - `privateToSeat = null`, no Table, not contained → eligible

- **Dual-fire / RPC integration** — mirrors `RtcTransport.test.ts`:
  - guest fires `click` locally → emits `guest-input-event` over transport → host receives → host's per-entity bus fires the same event with the originating seat in the payload
  - sender seat mismatch → host rejects (no host-side fire)
  - unknown entityId → host rejects

- **Component-side consumer** — light end-to-end:
  - subclass `EntityComponent` overriding `onClick`; spawn the entity; dispatch `click` on its bus; assert override was called with the payload.
  - confirms the lifecycle-method route registers on the same bus as scripts.

### Prior art

- `packages/client/src/input/tools/ToolDispatcher.test.ts` — fake pointer-event pattern, key-target injection
- `packages/client/src/input/tools/GrabTool.dropTarget.test.ts` — entity-with-component setup, raycast assertions
- `packages/client/src/entity/EntityEventBus.test.ts` — bus contract (isolation, snapshot iteration)
- `packages/client/src/entity/world/RtcTransport.test.ts` — transport / dual-fire integration
- `packages/client/src/seats/PrivacyScrubber.test.ts` — `privateToSeat` filter exhaustive cases

## Out of Scope

- Touch / pen gesture-specific behavior (long-press, two-finger). Pointer events accepted at face value; touch maps to button 0.
- Custom event names beyond the five listed. (Domain events like `value-changed` already exist on the bus and are unaffected.)
- Drag-and-drop event semantics (`drag-start` / `drop`). The existing `dropTargetRegistry` pipeline is unchanged.
- RMB / MMB events on entities. Right-click still routes through `ContextMenuController`.
- Suppressing events during axis-drag. Gizmo arms aren't entities, so the question doesn't arise.
- Throttling RPC traffic. If load testing later shows a problem, throttle then.
- Server-authoritative validation of `seat` field beyond the host-side mismatch check.
- Scripting API for synthetically dispatching input events (`entity.dispatchEvent('click', …)`). May be added later for testing scripts; not needed for the consumers listed above.

## Further Notes

- `GrabTool` constants `HOLD_MS` (150) and `MOVE_PX` (5) are reused as click thresholds. If they are tuned, both grab promotion and click detection move together — that coupling is intentional, since a press long enough to start a carry is by definition not a click.
- The `worldHit` field is absent (not `null`) for FlatView events — keeps the wire shape compact and lets script code use `if (e.worldHit)` as a 3D / 2D discriminant.
- Anticipated future component consumers: `HoverHighlightComponent`, `ButtonComponent`, `TooltipComponent`, `DropTargetHighlightComponent`. None are part of this PRD.
