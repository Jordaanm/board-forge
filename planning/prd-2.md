# PRD-2 — Tags, Containers, Cards, Decks, Hands, Seats

Decisions from grilling session. Source todo: `todo.md`.

## Tags

- **Storage (Q1):** Top-level `tags: string[]` field on `SceneEntry` and `ObjectState`. `ObjectTypeDef` declares `defaultTags` (e.g. cards default `['card']`).
- **Normalization (Q2):** stored lowercased + trimmed; allowed chars `[a-z0-9_-]`; reject spaces; cap 32 tags × 32 chars per tag. Normalize once at write time so filter checks are plain `Array.includes`.
- **Replication (Q3):** new `GameMessage` type `{ type: 'update-tags'; id; tags: string[] }`. Sent on the reliable RPC channel. Tags do not ride snapshot/patch.

## ID scheme

- Switch from `${type}-${counter}` to UUIDs system-wide. Required because `children` arrays store entry IDs and the system must be safe across host migration.

## Containers

- **Type model (Q4):** containers are new `SpawnableType`s (`'bag'`, `'deck'`). New interface `ContainerTypeDef extends ObjectTypeDef` carries `filterTags`, `capacity`, `accepts(entry)`, etc. Hand is modeled separately (zone, not physical container).
- **Parent-child representation (Q5):** logical parent only. Contained mesh removed from `THREE.Scene`; body removed from physics. Container entry has explicit `children: string[]` (array of UUIDs) for ordering. Child `SceneEntry` has `parentId: string | null`.
- **Snapshot inclusion (Q5b):** contained objects still appear in `SceneState` snapshots (so guests have full data) but their physics state is skipped.
- **Drop-to-add (Q6):** hybrid detection — geometric raycast on drag-end (immediate), plus AABB overlap check post-rest (catches thrown objects). Both gated on `acceptsTags()`.
- **Filter semantics (Q6):** **AND** — object must have *all* tags in the filter to enter.
- **Rejection (Q7):** rejection-with-snap-back. Drag-rejected: object snaps back to its `restPose` with subtle "denied" flash on the container. Throw-rejected: object stays where it landed on the table. No toast.
- **Nesting (Q21):**
  - Bag-in-bag: allowed; B2 retains its own contents and filter.
  - Deck-in-bag: allowed if bag filter permits.
  - Deck-in-deck: not allowed (decks only accept cards).
  - Hand-as-container: hand holds any object type but is not itself containable.
  - **No shortcut for nested draw** — must traverse one level at a time.

## Bags

- Capacity 0 = unlimited (per todo).
- **Draw next item (Q8):** uses **hover-grab** — drawn object pops to cursor and follows pointer without needing a hold; click anywhere to commit. New `DragController.attached` mode required.
- Draw order = random.

## Decks

- **Auto-formation (Q9):** spawn-then-absorb. New Deck entry created at receiving card's position; both card entries reparent into it; original card meshes removed. Triggers on drop/collision when at least one card is at rest. Requires new `{ type: 'reparent'; childId; parentId | null }` replication message.
- **Filter (Q20):** any card → any deck for first implementation. Category is only used for the spontaneous-formation rule.
- **Visual representation (Q16):** deck mesh shows top-card's `face` on its top side and bottom-card's `back` on its bottom side. Orientation derives from physics quaternion — no separate face-up flag. `children[0]` = top of deck convention.
- **Card asset model (Q16):** direct URLs only for now. `back` defaults to a bundled fallback image.
- **Deck-runs-out (Q17):** Draw X with X > remaining draws all remaining, no error. Deal X cycles seat-by-seat one card at a time when running low.

## Cards

- Properties: `category` (string, used for auto-formation), `face` (URL), `back` (URL), `value` (string).
- Default tags: `['card']`.

## Flip

- **Universal action (Q19):** all objects get a Flip action — 180° rotation around horizontal axis.
- Available via context menu **and** keyboard shortcut `F` while hovering.
- Flip works in hand. Hand cards are flat-plane meshes (face on one side, back on the other); flipping rotates the mesh and updates per-card stored orientation.
- Multi-flip (multi-select) deferred.

## Hands

- **Model (Q10):** Hand is a `SpawnableType` (`'hand'`) with `createBody() → null`. Mesh is a flat rectangle marking the zone. `mainHandSeatId` prop drives ownership. Container-like (children array, accepts anything; no filter). `SceneGraph.setMainHand(handId, seatId)` enforces the "one Main Hand per seat" invariant — assigning a new Main Hand clears the previous one.
- **Privacy (Q11):** per-peer filtering on host. `HostReplicator` sends peer-specific messages; private props (e.g. `face`, `value`) scrubbed from `ObjectState` for non-owners. New `private: true` flag on `PropertyDef` marks scrub-list. Non-owners always see the card back on **both** sides regardless of orientation (replace `face` with `back` for non-owners).
- **Rendering (Q12):** 3D fan. Cards are flat-plane meshes arranged in 3D space. Owner sees per-card orientation (face or back); non-owners always see backs.
- **Anchor (Q13):** zone-anchored. Fan floats above the hand zone; orientation derived from a `facing` yaw prop (auto-set from seat position). Defaults: arc 60°, radius 1.5 units, lift 0.8 units.
- **Hand-zone count tag (Q13):** not needed — non-owners count visually from the fan-of-backs.
- **Play from hand (Q18):** drag-from-fan. `DragController` extended to recognise fanned cards as draggable.
  - **18a:** card removed from hand `children` on drag-start (committed).
  - **18b:** card returns to scene at drag-start; replicated as a normal scene object thereafter (non-owners see a face-down card following the owner's cursor).
  - **18c:** orientation preserved from hand — face-up in hand → face-up on table; face-down in hand → face-down on table.

## Seats & Players

- **Identity model (Q14, Q15):** seats are stable game-mechanic identity; peers are transient connections. Each peer claims a seat on join.
- **Seat count:** fixed at 8. Each table type has a pre-configured layout for the 8 seats.
- **Session data per-seat:** all in-game session data (hand contents, owned objects) lives against the seat, not the peer. Changing seats — by leaving and rejoining or by deliberately switching — means assuming the previous occupant's data.
- **Vacant seat:** contents are publicly visible (face revealed for cards in vacant-seat hands). When a peer claims the seat, contents become private to that peer.
- **Host-as-player:** host must occupy a seat to be included in "each player" actions.
- **Deal target:** only seats with a Main Hand assigned receive cards. Invariant: every seat should have a Main Hand zone in standard table setups.
- **Deal order (Q17):** start at the seat next to the dealer, moving **counterclockwise**.

## Context menu actions

- **Parameterised actions (Q17):** `Draw X` and `Deal X` use **submenu** style — common counts (1, 2, 3, 5, 10) plus "Custom…".
- **Widget framework (deferred):** context menus need richer widgets (toggles, radio buttons, sliders, etc.). Architecture TBD; design pass after MVP.

## Replication message additions

- `{ type: 'update-tags'; id; tags: string[] }`
- `{ type: 'reparent'; childId; parentId: string | null }`
- Per-peer scrubbing in `HostReplicator` for `private: true` props.

## Out of scope (deferred)

- Multi-card flip / multi-select.
- User-uploaded asset library (S3) — direct URLs for PoC.
- Manual seat placement.
- Context menu rich-widget framework — basic submenus + numeric prompt only for first pass.
- Deck-onto-deck merge with category check.
- Shortcuts for drawing from nested containers.
