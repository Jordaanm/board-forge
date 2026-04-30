# PRD — Scene Graph (Entity-Component Refactor)

Decisions from grilling session against `scene-graph.md`. Source doc and current code (`packages/client/src/scene/SceneGraph.ts`, `objectTypes.ts`, `net/SceneState.ts`) describe two divergent models — the doc specifies an Entity + EntityComponent system; the code ships a flat `ObjectTypeDef` registry. This PRD locks the migration target.

## Refactor Strategy

Big-bang refactor to Entity + Component model. Existing `ObjectTypeDef` / `SceneEntry` / `ObjectState` / `update-props` / `patch` / `snapshot` machinery is replaced wholesale. PRD-2 (Cards, Containers, Hands, Decks) and PRD-seats (ownership, privacy) build on top of the new model and ship after this refactor lands.

## Component Model

### Identification

- Components keyed by `static typeId: string` on the class.
- Class is the public scripting / lookup token; `entity.getComponent(ValueComponent)` returns `ValueComponent | undefined` via TS generics.
- `typeId` is used for registry, wire format, and serialisation.

### Base class

```ts
abstract class EntityComponent<TState> {
  static typeId: string;
  static requires: string[] = [];
  static channel: 'reliable' | 'unreliable' = 'reliable';

  state: TState;
  entity!: Entity;

  abstract onSpawn(ctx: SpawnContext): void;
  abstract onPropertiesChanged(changed: Partial<TState>): void;
  onDespawn(ctx: SpawnContext): void {}
  onContextMenu(ctx: MenuContext): MenuItem[] { return []; }
  onCollision(other: Entity, event: CollisionEvent): void {}
  onParentChanged(newParentId: string | null, oldParentId: string | null): void {}
  onOwnerChanged(newOwner: SeatIndex | null, oldOwner: SeatIndex | null): void {}
  onAction(actionId: string, args: object | undefined, ctx: ActionContext): void {}

  setState(patch: Partial<TState>): void;          // host-only at runtime
  applyRemoteState(patch: Partial<TState>): void;  // inbound network path
  toJSON(): object;
  fromJSON(o: object): void;
}
```

### State + view layer

Components own both replicated state *and* derived view artifacts (e.g. `THREE.Object3D`, `CANNON.Body`). `toJSON`/`fromJSON` walk only `state`. View is rebuilt in `onSpawn` from state. `state` lives on the component as `state: TState` (generic).

### Mutation flow

- **Mutator:** `setState(partial)` is the single write path. Base class merges into `state`, queues a per-component patch for replication, fires `onPropertiesChanged(partial)` locally.
- **Remote arrival:** `applyRemoteState(partial)` performs the same merge + `onPropertiesChanged` call but does *not* re-queue replication.
- Direct property writes are forbidden by convention. Reads are direct (`this.state.x`).
- Multi-prop atomic updates fire one `onPropertiesChanged({ a, b })` so reactive view updates batch.

### Lifecycle ordering

- `onSpawn` runs in topological order of `static requires` dependencies.
  - Since components cannot be changed after spawn, this is a safe ordering, and the resolved order should be cached for performance.
- `onPropertiesChanged` runs in the same topological order across an entity's components for a given patch batch.
- `onDespawn` runs in reverse topological order.

### Universal lifecycle on every peer

`onPropertiesChanged` (and all other component hooks) run on every peer — host after `setState`, guests after `applyRemoteState`. This is engine-internal view-reflection logic, not user code, so does not violate the host-only scripting model.

## Entity

```ts
class Entity {
  id: string;                  // UUID (PRD-2)
  type: string;                // 'die', 'board', 'deck', 'card', 'hand', ...
  name: string;
  tags: string[];
  owner: SeatIndex | null;          // manipulation authority (PRD-seats)
  privateToSeat: SeatIndex | null;  // privacy-scrubbing key (this PRD)
  parentId: string | null;
  children: string[];               // ordered; empty for non-containers
  components: Map<string, EntityComponent<any>>;
  // transient, excluded from save:
  heldBy: SeatIndex | null;
}
```

- `parentId` and `children` are entity-level fields (not on `ContainerComponent`). Hands carry `children` without needing a generic ContainerComponent.
- `owner` (manipulation rights) and `privateToSeat` (info hiding) are deliberately separate. A card can be ownable by seat A but private to seat B.

### Default name

`${label}-${guid.slice(0, 8)}` — e.g. `Die-7a3e9f12`. Round-trips through save/load and host migration without a side-channel counter.

## Spawnables

TS module registry. JSON-compatible shape so a future move to file-loaded spawnables is mechanical.

```ts
type ComponentInit = { typeId: string; state: Record<string, unknown> };
type SpawnableDef = {
  type: string;
  label: string;
  defaultTags: string[];
  components: ComponentInit[];
};

registerSpawnable({
  type: 'die',
  label: 'Die (D6)',
  defaultTags: ['die'],
  components: [
    { typeId: 'transform', state: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] } },
    { typeId: 'mesh',      state: { meshRef: 'prim:cube', textureRef: '', size: 0.7 } },
    { typeId: 'physics',   state: { mass: 0.2, friction: 0.5, restitution: 0.5 } },
    { typeId: 'value',     state: { value: 6 } },
    { typeId: 'die',       state: { faces: 6 } },
  ],
});
```

- Single Entity per spawnable. Pre-populated decks belong in saved scene files, not spawnable definitions.
- Asset references are plain string URLs (or `prim:*` for built-in primitives). PRD-2 already locks "direct URLs only for PoC."
- Registration validates `static requires` against the component list; missing deps throw.

### Spawn flow

1. Lookup `SpawnableDef`.
2. Construct `Entity` with new UUID, type, default tags.
3. Instantiate each component class via registry; call `fromJSON(componentInit.state)` to populate state.
4. Call `onSpawn(ctx)` per component in topological order.
5. Replicate to peers as a single per-entity snapshot entry (same shape as Q12 save format).

## Authority and Mutation

Host-authoritative for everything. Guest mutations flow as RPCs:

```ts
// Guest-side
entity.requestUpdate(MeshComponent, { textureUrl: 'foo.png' });
// Wire: { type: 'request-update', entityId, typeId, partial }
// Host: OwnershipPolicy check → component.setState(partial) → replicate
```

- `setState` is host-only at runtime. Guest's local component instance only mutates via `applyRemoteState`.
- Scripts run on host, call `setState` directly (no RPC needed).
- OwnershipPolicy (per PRD-seats): owner may manipulate; host always may; spectators never; `owner === null` → any seated peer.

## Replication

### Wire shapes

```ts
// Per-component patch
type ComponentPatch = { entityId: string; typeId: string; partial: Record<string, unknown> };

// Entity-level field patch (replaces PRD-2's update-tags and update-props for entity fields)
type EntityPatch = {
  type: 'entity-patch';
  entityId: string;
  partial: Partial<{ name; tags; owner; privateToSeat; parentId; children }>;
};

// Per-entity snapshot (also save format)
type EntitySerialized = {
  id; type; name; tags; owner; privateToSeat; parentId; children;
  components: Record<string, object>;  // typeId → component.toJSON()
};

// Despawn
type DespawnBatch = { type: 'despawn-batch'; entityIds: string[] };  // reverse-tree order

// Action invocation
type InvokeAction = {
  type: 'invoke-action';
  entityId: string;
  componentTypeId: string;
  actionId: string;
  args?: object;
};

// Hold-claim / hold-release (transient drag lock)
type HoldClaim   = { type: 'hold-claim'; entityId: string; seat: SeatIndex };
type HoldRelease = { type: 'hold-release'; entityId: string };
```

### Channel routing

- Per-component class: `static channel: 'reliable' | 'unreliable'`. `TransformComponent` declares `'unreliable'` (60Hz physics path); everything else defaults `'reliable'`.
- Replicator buffers patches per channel per tick; flushes unreliable each physics step, reliable on a slower cadence (or immediately for low-frequency).
- `entity-patch`, `despawn-batch`, `invoke-action`, `hold-*` are always reliable.
- Reparenting (a child's `parentId` changes plus a parent's `children` array changes) is two atomic `entity-patch` entries delivered in one batched message.

## Save / Load

- **Save format = snapshot tree.** `{ version: 1; entities: EntitySerialized[] }`. Same shape consumed by late-joining peers.
- **Two-pass load:**
  1. Populate — for each entry: construct `Entity`, instantiate components, call `fromJSON(state)`. No `onSpawn`. No view artifacts. After phase 1, scene graph is fully populated as data.
  2. Spawn — walk entities; for each, call `onSpawn(ctx)` per component in topological order. Cross-entity refs work because all entities exist.
- **Cross-entity refs in component state** stored as raw GUID strings; resolved lazily via `Scene` singleton (`Scene.getEntity(guid)`).
- **Excluded from save:** `heldBy`, in-flight RPCs, un-settled physics velocities, grace timers.

## Scene Singleton

`Scene` exposed as a process-global singleton on each peer. Components do `Scene.getEntity(guid)` for ad-hoc lookups instead of carrying a reference. `SpawnContext` still passes scene + physics for instantiation work.

## Components shipped (PoC)

Transform · Mesh · 2D · Physics · Value · Container · Card · Zone · Hand · HiddenInfo · CustomData

- **2DComponent** kept (future support for non-card entities visible in hands).
- **ZoneComponent** kept; passive volume model:
  - Exposes `contains(other)`, `entitiesInside()`.
  - `subscribeEntries(handler)` / `subscribeExits(handler)` for opt-in events.
  - Entry events suppressed while the candidate entity has `heldBy != null` — an entity dropped (not dragged through) into a zone fires entry. Matches Tabletop Simulator.
  - Membership is *not* replicated; every peer runs the AABB overlap test locally against replicated transforms.
- **HandComponent** has *two* representations: a 3D zone in the play space and a 2D fan UI at the bottom of the screen. The 2D fan is a view rendering `entity.children`, not a second entity.
- **HiddenInfoComponent** uses ZoneComponent's enter/exit subscription to set `privateToSeat = zone.owner` on contained entities; clears on exit.

### Value Component

Defines the value of an entity, useful for things like Dice or Counters. Useful for sorting entities, or for gameplay features.
Defines exactly 2 properties: `value: string` and `isNumeric: boolean`.

No dependencies.

### Transform Component

Contains information aboue the position, rotation, and scale of an entity. Allows the entity to occupy a space in the 3d scene.

No dependencies.

### Mesh Component

Contains information about the 3d represnetation of an entity, including the mesh/model, textures, and materials. Also defines the hitbox for mouse interaction.
Allows the entity to be shown in the 3d scene.

Properties:
* mesh: a reference to the entity's 3d model.
  * for now, this mesh also defines the entity's hitbox.
* textures: a list of references to the entity's textures.
* materials: a list of references to the entity's materials.

Player Actions:
 * `rotateClockwise`: Rotates the entity around the Y axis.
 * `rotateCounterClockwise`: Rotates the entity around the Y axis in the opposite direction.
 * `scale`: Scales the entity uniformly in 3d

Depends on TransformComponent.


### 2D Component

Contains information about the 2d representation of an entity, which are basically a texture image, and 2d hitbox/dimensions. Derives scale from TransformComponent.
Allows the entity to be shown in UI, such as a hand, search results panel, etc.

Depends on TransformComponent;

### Physics Component

Contains information about the physical properties of an entity, such as its mass and friction. Almost every entity has one of these.

Properties:
* mass: the mass of the entity.
* friction: the friction of the entity.

Methods:
* `getVelocity(): Vector3` — returns the velocity of the entity.
* `setVelocity(velocity: Vector3)` — sets the velocity of the entity.
* `applyForce(force: Vector3)` — applies a force to the entity.
* `applyImpulse(impulse: Vector3)` — applies an impulse to the entity.
* `isAtRest(): boolean` — returns true if the entity is at rest.

Events:
* `onCollision(other: Entity, event: CollisionEvent)` — fires when the entity collides with another entity.
* `onStartMoving()` — fires when the entity starts moving.
* `onStopMoving()` — fires when the entity stops moving / comes to rest.

Player Actions:
* flick(direction: Vector3) — applies a force to the entity in the specified direction. Direction is derived from mouse movement and camera orientation.

Depends on TransformComponent, MeshComponent.



### Container Component

Defines the behaviour of an entity that can contain other entities, such as bags and decks.

Has a `filter` property, which is a list of tags. Only objects with all of the tags in the filter can be added to the container.

Exposes a number of methods for querying the contents of the container, and for adding/removing objects from the container, but relies on other components to wire up the behaviour to user interaction.

Typically, entities in a container are no longer visible in the scene graph, and are instead rendered as a child of the container.

Methods:
* `getContents(): Entity[]` — returns a list of entities that are contained within the container.
* `add(entity: Entity)` — adds an entity to the container. Manages the scene graph changes.
* `remove(entity: Entity)` — removes an entity from the container. Manages the scene graph changes.
* `query(tags: string[]): Entity[]` — returns a list of entities that match the specified tags.

Events:
* `onAdd(entity: Entity)` — fires when an entity is added to the container.
* `onRemove(entity: Entity)` — fires when an entity is removed from the container.

Player Actions:
* Search — opens a search panel, which allows the user to search for entities by tags. That same panel can be used to remove entities from the container.
* Shuffle — randomises the order of the entities in the container. Useful for a deck of cards, for example.
* Sort — sorts the entities in the container by their value.

Depends on TransformComponent, MeshComponent.

### Zone Component

A Zone is an entity that occupies a 3d space, affecting all other entities that enter/exit that space.

Exposes methods for querying the contents of the zone, and events for that trigger on entry/exit. Relies on other components to define the effects of enter/exit.

Properties:
* boundingBox: a 3d bounding box that defines the extents of the zone.

Methods:
* `getContents(): Entity[]` : a list of entities that are contained within the zone. (Source of truth for this is the scene graph, not the zone component.)
* `isEmpty(): boolean` : returns true if the zone contains no entities.

Events:
* `onEnter(entity: Entity)` : fires when an entity enters the zone.
* `onExit(entity: Entity)` : fires when an entity exits the zone.

Depends on TransformComponent.

### Card Component

Allows the entity to act as a card. Cards can be added to decks, and hands.
Cards have a "face" and a "back" texture. This is used to provide details to the Mesh Component.
Hooks into the Transform and Physics component events to track when a card is flipped, to determine if it is face-up or face-down.

Properties:
 * `category: string` — a string that identifies the type of card.
 * `face: string` — a reference to the card's front texture.
 * `back: string` — a reference to the card's back texture.

Methods:
 * `getFace(face: string): string` — returns the texture reference for the requested face.
 * `isFaceUp(): boolean` — returns true if the card is currently face-up.
 * `setFace(face: string, texture: string)` — sets the texture reference for the requested face.
 * `setValue(value: string)` — sets the value of the card.

Player Actions:
* `flip()` — flips the card.

 Depends on TransformComponent, MeshComponent, PhysicsComponent, 2DComponent.

### Dice Component

Allows the entity to act as a die.
Hooks into the Transform and Physics component events to track when a card is flipped, to determine what the value is, based on the faces and orientation.


Properties:
 * `faces: number` — the number of faces on the die.
 * `inverted: boolean` — whether the die is inverted (whether the upward face determines the value, or the downward face). A D6 would not be inverted, a D4 would.

 Events:
 * onRollStart() — fires when the die is rolled.
 * onRollEnd(value: number) — fires when the die has rolled, and the value is known.

Player Actions:
 * `roll()` — rolls the die.
 * `rollTo(value: number)` — rolls the die until it reaches the requested value.

 Depends on TransformComponent, MeshComponent, PhysicsComponent.

## Privacy Model

- New entity-level `privateToSeat: SeatIndex | null` field. Distinct from `owner`.
- PRD-2's `PropertyDef.private: true` flags stay as the redaction list per component.
- `PrivacyScrubber` gate: `recipient.seat !== entity.privateToSeat` → redact `private: true` properties.
- **Maintenance:**
  - `HandComponent.onParentChanged` for its children sets `child.privateToSeat = hand.owner`.
  - `HiddenInfoComponent` zone enter/exit subscription sets / clears `privateToSeat`.
- **Conflict rule:** auto-claim by a zone is a no-op if `privateToSeat` is already set. Hand-as-parent (explicit drag/deal) takes precedence over zone-as-container (passive overlap). Drag-add explicitly overwrites a zone-set value.
- **Vacant seat:** `HandComponent` clears `child.privateToSeat` when its `owner` becomes `null` (per PRD-seats vacant-seat reveal).

## Despawn

Cascade by default. Recursive depth-first descent; reverse-topological `onDespawn` per entity.

```ts
scene.despawn(entityId) {
  const e = scene.getEntity(entityId);
  if (!e) return;
  for (const childId of [...e.children]) scene.despawn(childId);
  for (const c of e.componentsInReverseTopOrder()) c.onDespawn(ctx);
  if (e.parentId) scene.getEntity(e.parentId)?.removeChild(entityId);
  scene.entities.delete(entityId);
}
```

Replicated as a single `despawn-batch` with the full id list in deletion order. Guest re-runs the same cascade against its local copies.

**Hand vacate is not a despawn.** PRD-seats vacant-seat hand persists; only `owner` clears, which triggers `HandComponent.onOwnerChanged` to clear children's `privateToSeat`.

## Context Menu

```ts
type MenuItem =
  | { kind: 'action';    id: string; label: string; disabled?: boolean }
  | { kind: 'submenu';   label: string; items: MenuItem[] }
  | { kind: 'heading';   label: string }
  | { kind: 'separator' };
```

- Components return `MenuItem[]` from `onContextMenu(ctx: MenuContext)`.
- Aggregator concatenates in topological order, inserting `{ kind: 'separator' }` between component groups.
- Universal Flip action (PRD-2) lives on a base class default, not duplicated per component.
- `MenuContext`: `{ recipientSeat, isHost, entity }`. Components decide per-item visibility / disabled state. Spectators get an empty or read-only menu.
- Click → guest sends `invoke-action` RPC → host validates ownership → `comp.onAction(actionId, args, ctx)` runs on host. Submenu "Custom…" items prompt the client UI for a value, then send `args: { count: N }`.

## Scripting Compatibility

Scripts remain host-only per `scripting-architecture.md`. The "guests run `onPropertiesChanged`" concern dissolves: that hook is engine-internal view-reflection code, not user logic. Scripts mutate state via `setState`; effects propagate to all peers via the standard replication path.

No user-defined components in PoC. Game-specific behaviour is host-side script logic that calls `setState` on engine components.

## Schema additions (recap)

- `Entity.privateToSeat: SeatIndex | null`
- `Entity.heldBy: SeatIndex | null` (transient, not persisted)
- `EntityComponent<TState>` base class shape above
- `static typeId`, `static requires`, `static channel` per component class
- Wire messages: `entity-patch`, `despawn-batch`, `invoke-action`, `hold-claim`, `hold-release`, `request-update`
- Per-entity snapshot tree (replaces `ObjectState` array)
- `MenuItem` discriminated union including `heading`

## Out of scope / deferred

- User-defined components — game logic stays in host-only scripts.
- `onTick` / per-frame component hook — physics ticks centrally; no consumer yet.
- `onAttach` / `onDetach` framework hooks — `onSpawn`/`onDespawn` are the bookends.
- Auto-detect zone capture for non-HiddenInfo / non-Hand consumers — Zones stay passive + opt-in subscription.
- Scene tree visual hierarchy nesting in Three.js — contained entities are *detached* from `THREE.Scene` (per PRD-2), not reparented in the visual graph.
- Schema evolution / save-version migrations — `version: 1` pinned for PoC.
- Pre-populated spawnable trees (e.g. a Deck spawnable that contains 52 cards) — composition lives in saved scene files.
- Rich context-menu widgets (toggles, sliders) — basic submenu + numeric prompt for first pass (per PRD-2).
- Asset-reference scheme beyond plain URLs / `prim:*`.

## Open follow-ups (next grilling pass)

- **Drag controllers (`DragController`, `GuestDragController`)** rewrite against the new component model. Mostly mechanical; needs a checklist.
- **`heldBy` lifecycle** specifics — exact sequence of hold-claim/release with respect to physics body kinematic-toggle, zone entry suppression, and conflict resolution when two peers race for the same entity.
- **Asset-reference convention** — confirm `prim:cube` / URL / future asset-key format.
- **Migration sequencing** — landing the big-bang refactor without breaking the project for an extended period (likely behind a feature flag, with a parallel-implementations interlude).
- **Script API for synthetic menu items** — scripts add per-entity context menu actions without registering custom components (e.g. `scene.addEntityAction(entityId, label, callback)` — wraps a host-side synthetic component).
- **HiddenInfoComponent edge cases** — entity overlapping multiple HiddenInfo zones owned by different seats; zone moves across entities while content is at rest.

## Build order

1. Entity + EntityComponent base class + registry; topological sort utility.
2. Scene singleton + spawn / despawn flow + per-entity snapshot serialiser.
3. Replication (`entity-patch`, per-component patch, channel routing) replacing existing `ObjectState`/`patch`/`update-props`.
4. Port primitives — Transform, Mesh, Physics, Value — to components; verify board / die / token spawn-replicate-despawn parity with current behaviour.
5. Drag controller rewrite (`heldBy`, hold-claim/release).
6. Save / Load round-trip on the new shape.
7. Table Seat integrations (`owner`, `privateToSeat` maintenance, OwnershipPolicy gating).
8. Container, Card, Hand, Zone, HiddenInfo components (PRD-2 / this PRD interop).
