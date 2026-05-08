# Entity Input Events

Adds five input events to every `Entity`, dispatched through the existing
`EntityEventBus`. Components such as `MeshComponent` and `FlatViewComponent`
contribute hit data via their respective picking surfaces; user scripts and
sibling components subscribe via `addEventListener`.

## API

Five kebab-case event names on the existing per-entity bus:

- `pressed`
- `released`
- `click`
- `hover-start`
- `hover-end`

Subscribed via `entity.addEventListener(name, cb)` (or
`EntityFacade.addEventListener(name, cb)` from script-land — same path,
adds teardown tracking).

Consumers: user scripts AND sibling components on the same entity. Tools
(`GrabTool`, etc.) are NOT consumers; they keep their existing raycasting.

## Payload

Uniform shape across all five events:

```ts
{
  seat:     SeatIndex | null;
  shiftKey: boolean;
  ctrlKey:  boolean;
  altKey:   boolean;
  worldHit?: { x: number; y: number; z: number };  // 3D-originated only
}
```

`worldHit` is absent for FlatView-originated events (no world coords for a
2D tile).

## Semantics

- LMB only (`button === 0`). RMB stays bound to the context menu; MMB stays
  with the camera controller.
- `pressed` fires on pointerdown over an eligible entity.
- `released` fires on pointerup, **captured on the entity that received
  `pressed`** — fires there even if the cursor has since left it.
- `click` fires after `released` iff all of:
  - cursor still over the captured entity, AND
  - total pointer travel ≤ 5 px (matches `GrabTool.MOVE_PX`), AND
  - elapsed since press < 150 ms (matches `GrabTool.HOLD_MS`).
- `hover-start` / `hover-end` fire on entity transitions. Detection is
  per-frame, so events fire when entities move under a stationary cursor
  (e.g. a thrown die rolls under the pointer).
- Topmost hit only. Closest intersect wins; underlying entities don't fire.
- Hover is suppressed on the currently-carried entity only. Other entities
  still fire normally — useful for drop-target highlights.
- Tool gestures (`GrabTool` carry, axis-drag, …) and these events are
  parallel observers of the same input. Both fire independently. A
  promoted carry naturally suppresses `click` (movement / time thresholds
  exceeded), so scripts get pressed → released without a click.

## Eligibility

These entities NEVER fire input events:

- `isContained === true` (mesh hidden; tile not rendered).
- The Table singleton (any entity with `TableComponent`). Matches the
  short-circuit `GrabTool` already applies.
- `privateToSeat` set to a seat other than the local viewer's. Anti-cheat
  consistency: only the seat that can see the entity can interact with it.

## Replication — dual-fire

Scripts run on host only; cursors live on every peer. To make scripts
authoritative observers without losing snappy local UX:

- The peer detecting the input fires the event locally on its bus (with
  `seat` payload).
- The detecting peer also RPCs to host; the host bus re-fires the same
  event. Host's scripts see all input regardless of origin.
- New `GuestInputMessage` variant: `{ entityId, eventName, payload }`.
- No throttling. Hover-start/hover-end already only fire on entity
  transitions; press/release/click are bounded by user input rate.

Local components (e.g. a hover-highlight component) react instantly without
a round-trip; host scripts see every peer's input.

## Architecture

A new `InputDispatcher`, sibling to `ToolDispatcher`, owned by
`ThreeCanvas`. Single owner of all five events.

Responsibilities:

- Per-frame raycast against `MeshComponent.group` objects; tracks topmost
  hovered entity; emits `hover-start` / `hover-end` on transitions.
- Owns capture-target state for press → release → click pairing.
- Owns the dual-fire helper (`fireInputEvent(entity, name, payload)`) that
  performs local dispatch + host RPC.
- Reads modifier keys from the originating pointer event.

`HandPanel` reuses the same `fireInputEvent` helper for FlatView-originated
events — the helper is the single dual-fire entry point.

`FlatViewComponent` stays a pure data marker. Press/click dispatch for
2D tiles happens at the React event call site in `HandPanel`, not inside
the component.

`MeshComponent` is also unchanged. Picking iterates `Mesh.group` objects
from the InputDispatcher; the entity reference is recovered via
`World.pickByObject3D` (existing API).

## Cleanup

- `EntityEventBus.clear()` on despawn handles listener teardown.
- `EntityFacade` already tracks per-Run subscriptions for ScriptHost
  teardown — new event names use the same pipe.
- If an entity is despawned while it is the press-capture target, the
  InputDispatcher drops the capture without firing `released`.
