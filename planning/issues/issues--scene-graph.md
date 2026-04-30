# Issues — Scene Graph (Entity-Component Refactor)

Source: `planning/prd--scene-graph.md`. Builds on the completed Seats MVP (`planning/issues/issues--seats-mvp.md`).

Seven vertical slices following the PRD's build order. Slice 4 is the cutover — old `SceneGraph` / `objectTypes` / flat `ObjectState` paths are deleted there. Slices 1–3 land the new system in parallel behind a flag so the runtime stays demoable throughout. Save / Load is **deferred to a follow-up PRD** and intentionally not in this list.

PRD-2 components (Container, Card, Hand, Zone, HiddenInfo, 2D) are out of scope here — they ship in their own PRD on top of slices 1–7.

---

## 1. `Entity` + `EntityComponent` + `Scene` foundation

**Status:** Completed
**Type:** AFK
**Blocked by:** None — Seats MVP delivered the prerequisites (`SeatIndex`, `OwnershipPolicy`, `PrivacyScrubber` seam).

### What to build

Pure data + lifecycle framework. `Entity` class with the full schema (`id`, `type`, `name`, `tags`, `owner`, `privateToSeat`, `parentId`, `children`, `components`, `heldBy`). `EntityComponent<TState>` abstract base with every hook (`onSpawn`, `onPropertiesChanged`, `onDespawn`, `onContextMenu`, `onCollision`, `onParentChanged`, `onOwnerChanged`, `onAction`) plus `setState` / `applyRemoteState` / `toJSON` / `fromJSON`. `Scene` singleton with `getEntity(guid)`. Component registry keyed by `static typeId`. Topological-sort utility resolving `static requires`. `EntitySerialized` snapshot type and the two-pass load (populate → spawn). No runtime integration; existing `SceneGraph.ts` / `objectTypes.ts` remain the authoritative runtime.

### Acceptance criteria

- [ ] `Entity` exported with the schema in PRD § Entity. Default name format `${label}-${guid.slice(0,8)}`.
- [ ] `EntityComponent<TState>` abstract base exported with all hooks (default no-ops where the PRD says) and `static typeId` / `static requires` (default `[]`) / `static channel` (default `'reliable'`).
- [ ] `setState(partial)` merges + fires `onPropertiesChanged`; `applyRemoteState(partial)` same merge + hook without re-queueing replication.
- [ ] Multi-prop atomic update fires a single `onPropertiesChanged({ a, b })`.
- [ ] Component registry exposes `register(componentClass)` / `get(typeId)`; registration validates `requires` against known `typeId`s and throws on missing deps.
- [ ] Topological-sort utility returns onSpawn order; reverse for onDespawn. Cycles throw.
- [ ] Cached topo order per spawnable definition.
- [ ] `Scene` singleton with `getEntity(guid)` and an entity `Map`.
- [ ] `EntitySerialized` defined; `toJSON`/`fromJSON` walk `state` only.
- [ ] Two-pass load: phase 1 populates entities + components + `fromJSON`; phase 2 walks topo order calling `onSpawn`. Cross-entity GUID refs in component state resolve via `Scene.getEntity`.
- [ ] Unit tests cover: topo sort (linear, diamond, cycle-throws, missing-dep-throws), registry, two-pass load round-trip with cross-entity refs, default name format.
- [ ] No imports from `SceneGraph.ts` / `objectTypes.ts`. New code lives under a clean module path (implementer's call).

---

## 2. Replication wire shapes + per-channel routing

**Status:** Completed
**Type:** AFK
**Blocked by:** #1

### What to build

New wire-message shapes and a v2 replicator path that buffers per-component patches per tick, separated by `static channel`. v2 replicator coexists with the old broadcast path and is engaged behind a flag. Guest reception dispatches `entity-patch` / `component-patch` into `applyRemoteState`. Existing `SceneState` / `patch` / `update-props` remain primary for the runtime until slice 4.

### Acceptance criteria

- [ ] Wire types defined: `ComponentPatch`, `EntityPatch`, `EntitySerialized`, `DespawnBatch`, `InvokeAction`, `HoldClaim`, `HoldRelease`, `request-update`.
- [ ] v2 replicator buffers patches per channel per tick. Unreliable flushes each physics step; reliable on a slower cadence (or immediately for low-frequency).
- [ ] `entity-patch`, `despawn-batch`, `invoke-action`, `hold-*` always reliable, regardless of source.
- [ ] Reparenting emits two atomic `entity-patch` entries (child `parentId` + parent `children`) in one batched message.
- [ ] Guest receive: `component-patch` → `entity.getComponent(...).applyRemoteState(partial)`; `entity-patch` → entity-level field merge; `despawn-batch` → cascade delete; `invoke-action` ignored on guest.
- [ ] Tests: channel separation, per-tick buffer + flush, reparenting batch atomicity, encode/decode round-trip per message.
- [ ] v2 path off by default. Engaging it does not yet replace the existing replicator.

---

## 3. Port primitives (Transform, Mesh, Physics, Value) under flag

**Status:** Completed
**Type:** AFK
**Blocked by:** #2

### What to build

`TransformComponent` (channel: `'unreliable'`), `MeshComponent` (requires Transform), `PhysicsComponent` (requires Transform, Mesh), `ValueComponent` (no deps). Spawnable defs for `board` / `die` / `token` using the new components. Behind a feature flag, the v2 system drives the runtime — spawn instantiates components, `onSpawn` builds the view artifacts (`THREE.Object3D`, `CANNON.Body`), `onDespawn` tears them down. Parity tests confirm spawn / replicate / despawn match the existing flat system.

### Acceptance criteria

- [ ] `TransformComponent` with `position`, `rotation`, `scale`; `static channel = 'unreliable'`.
- [ ] `MeshComponent` with `meshRef`, `textureRef`, `size`; depends on Transform.
- [ ] `PhysicsComponent` with `mass`, `friction`, `restitution`; depends on Transform + Mesh; exposes `getVelocity` / `setVelocity` / `applyForce` / `applyImpulse` / `isAtRest`. Emits `onCollision` / `onStartMoving` / `onStopMoving`.
- [ ] `ValueComponent` with `value`, `isNumeric`; no deps.
- [ ] Each `onSpawn` builds its view artifact from `state`; `onDespawn` tears it down. Asset refs resolve `prim:*` for built-in primitives; URL strings for the rest.
- [ ] Spawnable defs registered for `board`, `die`, `token` — same set today's flat system supports.
- [ ] Feature flag (URL param or env) selects scene system. Flag-on: v2 drives the runtime; flag-off: existing flat system unchanged.
- [ ] Parity: with flag on, spawn / drag-replicate (host) / despawn / dice-roll behaviours match flag-off.
- [ ] Tests: spawn → replicate → despawn for each primitive; serialized snapshot shape matches expected `EntitySerialized`.
- [ ] No visible regressions in flag-off mode.

---

## 4. Switch runtime over, delete old scene code

**Status:** Completed (manual two-tab smoke pending — typecheck + 126 unit tests pass)
**Type:** AFK
**Blocked by:** #3

### What to build

Promote v2 to default and delete the flag, `SceneGraph.ts`, `objectTypes.ts`, the flat `ObjectState` / `snapshot` / `patch` / `update-props` / `table-update` paths, and any legacy guest receive handling. `HostReplicator` and the guest receive path operate solely on the new wire shapes. Manual smoke verifies parity end-to-end.

### Acceptance criteria

- [ ] Feature flag from #3 removed; v2 is the only system.
- [ ] `packages/client/src/scene/SceneGraph.ts` and `objectTypes.ts` deleted (or reduced to component classes only).
- [ ] `ObjectState`, flat `snapshot`/`patch`, `update-props`, `table-update` removed from `SceneState.ts` and all consumers.
- [ ] `HostReplicator` operates on `EntityPatch` / `ComponentPatch` / `DespawnBatch` only.
- [ ] Guest receive path dispatches new messages exclusively.
- [ ] Manual two-tab smoke: spawn board / die / token, drag, roll dice, delete — behaviour identical pre/post-cutover.
- [ ] Existing tests updated or removed; client `npm test` and `npm run typecheck` pass.

---

## 5. Drag rewrite + `heldBy` lifecycle

**Status:** Completed (typecheck + 134 unit tests pass; manual two-tab smoke pending)
**Type:** AFK
**Blocked by:** #4

### What to build

Rewrite `DragController` and `GuestDragController` against the Entity + Component model. Add `hold-claim` / `hold-release` reliable messages with host validation. `entity.heldBy` is the per-seat lock; host sets it on a successful claim and clears it on release, drag-end, or peer disconnect. Physics body toggles to kinematic while held. Zone-entry suppression placeholder lives here (consumed by PRD-2 zones). First-claimer-wins on contention; later claims refused while `heldBy != null`.

### Acceptance criteria

- [ ] `DragController` resolves drag targets as `Entity` and reads required components via generics.
- [ ] `GuestDragController` sends `hold-claim` before drag start; defers UI feedback until host confirms.
- [ ] Host refuses `hold-claim` if `entity.heldBy != null` (no preemption).
- [ ] On accept, host sets `entity.heldBy = seat` and replicates via `entity-patch`.
- [ ] `hold-release`, drag-end, or peer disconnect clears `heldBy`. Engine clears `heldBy` for any entity held by a leaving seat.
- [ ] Physics body switches to kinematic on hold; restored on release with end-of-drag velocity (preserve current flick behaviour).
- [ ] Zone-entry events suppressed while `heldBy != null` (placeholder; no live zone consumers yet).
- [ ] Tests: claim accepted → `entity-patch` replicated; claim refused (already held); release path; disconnect-clears-held; kinematic toggle on/off.

---

## 6. Seat integrations: `owner` gating + `privateToSeat` field

**Type:** AFK
**Blocked by:** #5

### What to build

Wire the seat layer into the new entity model. `OwnershipPolicy.canManipulate` gates drag (host and guest) and host-side `request-update` RPC handling. Add `Entity.privateToSeat: SeatIndex | null` to the schema and serialize it; the existing `PrivacyScrubber` seam in `HostReplicator` already consumes it (registry stays empty until PRD-2). No `privateToSeat` maintainer ships here — PRD-2's HiddenInfo and Hand fill that role.

### Acceptance criteria

- [ ] `DragController.canStartDrag(entity)` consults `OwnershipPolicy.canManipulate({ peerSeat, isHost }, entity.owner)`.
- [ ] `GuestDragController` sends `hold-claim` only when `canManipulate` is true; host re-validates and refuses otherwise.
- [ ] Host `request-update` handler validates against `OwnershipPolicy` before invoking `setState`.
- [ ] `Entity.privateToSeat: SeatIndex | null` field present, serialized via `EntitySerialized`, and threaded into `entity-patch`.
- [ ] `HostReplicator` per-recipient scrub receives `entity.privateToSeat`; registry remains empty (no behavioural change vs Seats MVP slice #5).
- [ ] Spectator paths refuse all manipulation (drag, RPC).
- [ ] Tests: drag refused for non-owner / spectator / wrong seat; drag accepted for owner / host / unowned-seated; RPC refused on host for non-owner.

---

## 7. Context menu refactor (component-driven `onContextMenu`)

**Type:** AFK
**Blocked by:** #6

### What to build

`MenuItem` discriminated union (`action` / `submenu` / `heading` / `separator`). `EntityComponent.onContextMenu(ctx: MenuContext) → MenuItem[]`. Aggregator concatenates components in topological order, inserting a separator between non-empty groups. `MenuContext = { recipientSeat, isHost, entity }`. Click → guest sends `invoke-action` → host runs `OwnershipPolicy` check → `comp.onAction(actionId, args, ctx)`. Submenu "Custom…" prompts the client UI for a numeric value, sends `args: { count: N }`. No component-specific menu items ship here — components inherit the base no-op. Universal Flip is deferred to PRD-2 (Card).

### Acceptance criteria

- [ ] `MenuItem` exported as a discriminated union: `action`, `submenu`, `heading`, `separator`.
- [ ] `MenuContext` shape: `{ recipientSeat: SeatIndex | null; isHost: boolean; entity: Entity }`.
- [ ] Aggregator walks components in topo order; inserts a single `separator` between non-empty groups.
- [ ] Spectators receive an empty menu (or read-only items only).
- [ ] `invoke-action` RPC `{ type, entityId, componentTypeId, actionId, args? }`. Host route: lookup component → `OwnershipPolicy` check → `onAction(actionId, args, ctx)`.
- [ ] Submenu "Custom…" prompts client UI for a numeric value, then sends `args: { count }`.
- [ ] Existing `ContextMenu` / `ContextMenuController` updated to render the new shape.
- [ ] Tests: aggregation order + separators; spectator menu empty; RPC ownership refusal; numeric prompt round-trip.

---

## Dependency graph

```
#1 (Entity + Component + Scene foundation)
 └─→ #2 (replication wire shapes + channel routing)
      └─→ #3 (port primitives under flag)
           └─→ #4 (switch + delete old code)
                └─→ #5 (drag rewrite + heldBy)
                     └─→ #6 (seat integrations)
                          └─→ #7 (context menu refactor)
```

After all 7 land, `prd--scene-graph.md` is closed and `prd-2.md` (Cards / Containers / Hands / Decks) plus the deferred Save / Load PRD become the next priorities.
