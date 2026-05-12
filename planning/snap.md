# Snap Points

Placement aid that teleports a dropped object onto a pre-defined position/yaw when released nearby. Used for layout drop zones (e.g. "deck goes here") and edge-aligning entities into rows.

## Data model

New `SnapPointsComponent` (typeId `snap-points`). Attaches to any entity. Reliable replication channel.

```ts
type SnapPoint = {
  id:            string;
  localPos:      [number, number, number]; // relative to parent transform
  localYaw:      number;                   // radians
  snapRotation:  boolean;                  // apply localYaw on snap
  radius:        number;                   // XZ-plane only
};

type SnapPointsState = {
  points: SnapPoint[];
};
```

No tag filtering, no occupancy tracking. Multiple objects may snap to the same point.

## Entities

- Any entity may carry `SnapPointsComponent`.
- New `SnapMarker` spawnable: `Transform` + `SnapPoints` only. No mesh, no physics. Default one point at `(0,0,0)`, `yaw 0`, `snapRotation false`, default radius (table-scale constant, tunable).
- Built-in spawnables (`card`, `die`, `token`, `board`) ship with empty snap points in v1. Spawnable-level defaults are supported as a mechanism for future use.

## Visibility

Host-only, gated by a static flag `SnapPointsComponent.showAll`. Toggled from `HostActionBar` mirroring `Show All Zones`. Guests never render snap points or `SnapMarker` regardless of flag.

When on:

- Each snap point renders as a translucent green disc, radius = point radius, lying horizontally at the point's world position.
- Forward arrow along +Z drawn only when `snapRotation` is true, rotated by `localYaw`.
- `depthWrite: false`. Attached as a child of the parent's TransformComponent group.

When off:

- Invisible. Not raycastable. `SnapMarker` cannot be grabbed.

## Snap algorithm

Triggered only on `GrabTool` drop, host-authoritative. Guest drops route through host RPC as today.

1. Iterate all entities with `SnapPointsComponent`. For each point, compute world position via parent transform.
2. Filter: XZ-only distance from dropped entity origin to point ≤ `point.radius`.
3. Exclude points on dropped entity or its descendants (self-exclusion).
4. Closest XZ distance wins.
5. **Hit**: set dropped entity position to point's world pos (Y from point), set yaw if `snapRotation`, zero linear + angular velocity.
6. **Miss**: throw velocity as today.

Not triggered by scripted `setPosition`, state load, or initial spawn.

### Distance metric

XZ-plane only. `sqrt(dx² + dz²) <= radius`. Carry height is ignored. Y of snapped result comes from `point.localPos.y`.

## Authority and replication

- Host computes snap. Final pose broadcast as a normal `TransformComponent` patch.
- `SnapPointsComponent` state replicates on reliable channel.
- No scripting API hook in v1.

## Editor UX

`SnapPointsComponent.onEditorTools` contributes a numeric form to the host editor panel:

- List of existing points.
- Per-row inputs: x, y, z, yaw, radius, `snapRotation` checkbox, delete.
- "Add" appends a new point at origin.

Deferred: click-to-place, 3D gizmo, duplicate-from-other-entity.

## SnapMarker UX

- Registered in `spawnables.ts` alongside `card`, `die`, etc. Spawned via the existing host spawn UI.
- Default position: existing spawnable default (offset from host camera target).
- Deletable, renameable, taggable, editable like any other entity.
- Grabbable only when `Show Snap Points` is on (rendering also gates raycast).

## Out of scope for v1

- Tag filtering (`accepts`).
- Occupancy tracking.
- Drag-time preview / magnetic pull.
- Per-instance click-to-place or 3D gizmo editing.
- Built-in default snap points on `card`/`die`/`token`/`board`.
- Scripted snap API (`scene.snapToNearest`, `onSnap` hook).
- Auto-snap on scripted moves, state load, or spawn.
