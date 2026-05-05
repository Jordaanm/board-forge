# PRD — Decks

## Problem Statement

Cards are first-class entities (`CardComponent`, `prim:card` mesh, hand panel, privacy scrubbing), but the game has no way to stack them. A 52-card poker game requires the player to manually arrange dozens of individual card entities, every shuffle is impossible, every deal is manual, and a peer with a debugger can read the entire face of every card no matter where it sits on the table. The Hand primitive solves layout for cards in a player's hand, but there is no equivalent stacking primitive for cards on the table.

## Solution

A new `DeckComponent` and `deck` entity type, modeled on Tabletop Simulator's deck behavior:

- Two unheld cards of the same `category` colliding spontaneously form a deck. A card colliding with an existing deck (same category) joins it. The newest-arriving card is index 0 — the "top" — and its face is rendered on the deck's visible top.
- Cards inside a deck remain entities (preserving their GUIDs and refs for scripting) but are flagged hidden — their mesh stops rendering and their physics body leaves the world. The deck owns a single `prim:deck` mesh whose height scales linearly with the contained-card count.
- When a deck reaches one card, the deck dissolves: the lone card un-hides at the deck's pose and the deck despawns.
- Right-click context menu on a deck exposes `Shuffle`, `Deal X`, and `Draw X`. All three gate on the existing `canManipulate` ownership rule.
- In-deck cards' `face`/`back` are scrubbed for non-host peers — only the host knows the order. Drawing a card re-emits its real face/back to its new owner via the same machinery `HandComponent` uses for in-hand privacy.

## User Stories

### Forming and dissolving decks

1. As a player, when I drop one card on top of another card of the same category, I want them to spontaneously form a deck, so that I don't have to manually create a container.
2. As a player, when I drop a card on top of an existing deck of the same category, I want the card to be added to the deck, so that stacking is the natural physical interaction.
3. As a player, I want category mismatches to bounce physically off the deck, so that I get visual feedback that the merge was rejected without an error toast.
4. As a player, when a deck has only one card left, I want the deck to dissolve into a normal card at the deck's position, so that I never end up with a single-card stack.
5. As a player, the newest card I drop on a deck becomes the top card whose face is visible, so that I can see what I just placed.

### Drag and physics interaction

6. As a player, while I'm holding a card, I don't want it to merge with anything I drag it past, so that I retain control until I release.
7. As a player, when I release a card while it's already touching a deck, I want the merge to fire as if I'd just dropped it from above, so that drag-and-release is a reliable input.
8. As a player, while I'm holding a deck, I don't want cards I sweep past to vacuum into it, so that the drag is predictable.
9. As a player, I want to drag a deck around the table like any other physics entity, so that I can position it where the game needs it.

### Hand interaction

10. As a player, cards already in my hand never spontaneously form a deck when they bump each other in the layout, so that my hand stays a fan and not a stack.
11. As a player, when I drag a card from my hand panel onto a deck on the table, I want it to join the deck via standard collision, so that the rule is consistent with table-to-table drops.

### Actions

12. As a deck owner (or any seated player if the deck is unowned), I want a right-click menu on the deck with `Shuffle`, `Deal`, and `Draw`, so that I have the full TTS-style verb set.
13. As a player invoking `Shuffle`, I want a brief visual confirmation (a deck wiggle), so that I know the shuffle landed.
14. As a player invoking `Draw N`, I want the top N cards to tween from the deck to my main hand face-up, so that I see what I drew.
15. As a player invoking `Draw N` while I have no main hand, I want the action greyed out, so that I'm not silently confused when nothing happens.
16. As a player invoking `Deal N`, I want one card dealt to each seated player (with a main hand) starting clockwise from me, repeated N times, so that the order matches card-game convention.
17. As a player invoking `Deal N` and the deck runs out, I want dealing to stop where it ran out, so that the action degrades predictably rather than throwing.
18. As a player, I want `Deal` and `Draw` to expose `1, 2, 3, 5, Other...` quick-pick submenus, so that common counts are one click.

### Privacy and replication

19. As a player, I don't want other peers to be able to read the face of cards buried in a deck via a debugger, so that shuffle is meaningful.
20. As a player drawing from a deck, the card's real face is revealed to me (and only me, while it's in my hand), so that the privacy boundary handoff is seamless.

### Visual

21. As a player, I want a deck's height to scale with the number of cards in it, so that I can gauge stack size at a glance.
22. As a player, I want the deck to render with striped sides showing each card slab, so that it reads as "stack of cards" rather than "tall card".
23. As a player, the deck's visible top face is the first card's face and the visible bottom is the last card's back, so that I always know what's on top.

## Implementation Decisions

### Data model

- **`Entity.isHidden: boolean`** — new field on the base `Entity` class, default `false`. Replicates via the existing entity-patch flow (alongside `parentId`, `heldBy`, `privateToSeat`). Components observe it and self-suppress.
- **`DeckComponent`** — new component, `static typeId = 'deck'`, `static requires = ['transform', 'mesh', 'physics']`. State:
  ```ts
  interface DeckState {
    cards:    string[];   // ordered, index 0 is the top ("first")
    category: string;     // inherited from founding cards
  }
  ```
- **`prim:deck` mesh** — new primitive in `MeshComponent.buildMesh`. BoxGeometry whose height = `0.02 × cards.length`. Material slot map: `face` on +Y (top), `back` on -Y (bottom), and `side` on the four edge faces with a striped texture that draws `cards.length` slabs. Slab thickness is a constant 0.02 regardless of true card thickness, so a 2-card deck still reads as a stack.
- **Spawnable registration**: `deck` is registered with `registerSpawnable` so `Scene.spawn('deck', ...)` resolves, but is **flagged out of the spawn menu** (new `internal: true` field on `SpawnableDef`, defaulted false). Decks are only born from card↔card merge.
- **Deck mass / physics**: mass = `cardMass × cards.length`, friction/restitution copied from `prim:card`. Hitbox derived from the same height-scaled box.
- **Deck name**: default `Deck of {category}` on spontaneous formation. Falls back to the existing `defaultEntityName('Deck', guid)` when category is empty.

### Component reactions to `isHidden`

- **`MeshComponent`**: in `onSpawn` and on `isHidden` patch, set `group.visible = !entity.isHidden`. Mesh is constructed regardless — toggling visible is cheap.
- **`PhysicsComponent`**: on `isHidden` flip to `true`, call `physics.world.removeBody(this.body)`. On flip to `false`, re-add. Body is preserved in memory; mass/shape/etc. don't rebuild. Existing collision handlers stay attached.
- **`Entity` patch handler**: extend the partial-merge in `wire.ts` (the `applyEntityPatch` function) to handle `isHidden` and trigger a re-application across all components on the entity (each component's `onPropertiesChanged` is the natural seam, but `isHidden` lives on the entity, not on a component — so add a dedicated `entity.onIsHiddenChanged` fan-out or have `MeshComponent`/`PhysicsComponent` subscribe to entity-level patches).

### Merge logic (host-only)

Lives in `DeckComponent` and a new helper `MergeService` (or extension to `HoldService`). Invoked from two seams:

1. **Physics collision** — `PhysicsComponent.collide` event. The host listener in the existing collide path filters and dispatches.
2. **Hold release** — `HoldService` already has a release hook; extend it to run `recheckMergeOverlaps(entity)` on the released entity, walking its current contact list to fire the same merge logic. Closes the gap where a card released while already in contact wouldn't re-fire `beginContact`.

Common merge predicate (`canMerge(a: Entity, b: Entity): boolean`):
- Both are unheld (`a.heldBy === null && b.heldBy === null`).
- Both have `privateToSeat === null` (excludes hand-resident cards).
- Neither is already inside a deck (`a.isHidden === false && b.isHidden === false`, where appropriate).
- Categories match: `cardCategory(a) === cardCategory(b)`, where `cardCategory` reads `CardComponent.state.category` for cards or `DeckComponent.state.category` for decks.
- At least one side is a card (two decks colliding does not merge in slice 1 — see Out of Scope).

Merge actions:
- **Card↔card**: spawn a new `deck` entity at the lower (lower-Y) card's transform, name `Deck of {category}`, owner `null`, category from founding cards. Set both cards' `isHidden=true`, `parentId=deck.id`. The newest-arriving card (the one whose physics body was higher at impact) goes to index 0; the at-rest card to index 1.
- **Card↔deck**: card's `isHidden=true`, `parentId=deck.id`; insert at `cards[0]`. Deck's transform unchanged.

### Singleton degradation

After every removal from `DeckComponent.cards` (Draw, Deal), the host runs `maybeDissolve()`:
- If `cards.length === 1`: synchronously clear the lone card's `isHidden=false`, `parentId=null`, set its `TransformComponent` to the deck's pose (zero linear + angular velocity on its `PhysicsComponent.body`), then `Scene.despawn(deck.id)`.

### Privacy

Reuse the existing `PrivacyScrubber` pattern (currently in `HostReplicatorV2` for hand cards):
- A card whose `parentId` points at a deck entity has its `face` and `back` blanked in the patch sent to non-host peers. Same scrubber, new condition.
- On `Draw` (or any removal), the host calls `card.setState({ face: card.state.face, back: card.state.back })` on the card after clearing `isHidden`/`parentId` — the round-trip emits a real-face patch that reaches the new owner with the real values (because the scrubber sees `parentId === null` at emit time). This mirrors `HandComponent.reEmitPrivateFields`.
- The deck's own `MeshComponent.textureRefs.face` and `.back` reflect the top/bottom card and are public — that's the intended visible state.

### Mesh material binding (live update)

When `cards` changes (insert / remove / shuffle), the host:
1. Patches `DeckComponent.cards`.
2. The deck's `onPropertiesChanged` reads `cards[0]` and `cards[cards.length - 1]`, looks up each card's `CardComponent.state.face` / `.back`, and patches the sibling `MeshComponent.textureRefs` (`face` slot ← top card's face, `back` slot ← bottom card's back).
3. Also patches the sibling `MeshComponent.size` so height scales: `[w, 0.02 × cards.length, d]` where `[w, d]` are the standard card width/depth.

Guests don't recompute materials — they receive the `MeshComponent` patch and rebuild as normal.

### Actions

All three live as `MenuItem`s returned from `DeckComponent.onContextMenu`. All three gate on `canManipulate(ctx, entity.owner)`.

- **Shuffle**:
  - Menu: top-level `{ kind: 'action', id: 'shuffle', label: 'Shuffle' }`.
  - Host: Fisher-Yates on a copy of `cards`; `setState({ cards: shuffled })`. Run a 200ms `TweenComponent` rotation jitter on the deck for visual feedback. Top/bottom material binding refreshes via the standard patch flow.
  - Guest: emits `{ type: 'shuffle-deck', deckId }` RPC (new wire type).

- **Draw N**:
  - Menu: parent `Draw` with submenu items for `1, 2, 3, 5` plus an `Other...` numeric-input item (new `kind: 'numeric'` `MenuItem` — see below).
  - Disabled (greyed out) when `mainHandFor(callerSeat)` is null.
  - Host:
    1. Pop `min(N, cards.length)` from the front of `cards`.
    2. For each popped card, set `isHidden=false`, `parentId=null`, transform to deck top pose, then call `world.tweenIntoHand(card, mainHandId)`. Tween is the standard 250ms.
    3. Re-emit face/back so the recipient peer gets the real values (privacy handoff).
    4. Run `maybeDissolve()`.
  - Guest: emits `{ type: 'draw-from-deck', deckId, count }`.

- **Deal N**:
  - Menu: parent `Deal` with submenu `1, 2, 3, 5, Other...`.
  - Host:
    1. Build the recipient list: seats with a main hand, ordered clockwise from the caller seat (caller first). Cyclic.
    2. Loop `round = 0..N-1`; for each recipient in order, if `cards.length === 0` break; otherwise pop top card and tween into that seat's main hand, with a `round * recipients.length + i` × 80ms stagger delay.
    3. Run `maybeDissolve()` after the last tween schedule.
  - Guest: emits `{ type: 'deal-from-deck', deckId, count }`.

### New menu-item kind

Extend `EntityComponent.MenuItem` discriminated union with:
```ts
| { kind: 'numeric'; id: string; label: string; min?: number; max?: number; default?: number }
```
The renderer in `ContextMenu.tsx` shows a small numeric input + confirm button. On submit, it dispatches an action with `args = { value: number }`. Existing `colorpicker` is a precedent for non-trivial menu inputs.

### Modified modules

- **`Entity.ts`** — add `isHidden: boolean` field, default `false`.
- **`MeshComponent.ts`** — add `prim:deck` to `buildMesh`; observe `entity.isHidden`; build the striped-sides material.
- **`PhysicsComponent.ts`** — observe `entity.isHidden`; add/remove body from world on flip.
- **`HoldService.ts`** — on release, call new `recheckMergeOverlaps`.
- **`HostReplicatorV2.ts`** (or wherever `PrivacyScrubber` lives) — extend the scrub condition: also scrub `face`/`back` when the card's `parentId` resolves to a deck entity.
- **`wire.ts`** — handle `isHidden` in `applyEntityPatch`; add wire types `shuffle-deck`, `draw-from-deck`, `deal-from-deck`.
- **`World.ts`** — add `shuffleDeck`, `drawFromDeck`, `dealFromDeck` methods, mirroring the existing host/guest split (host runs directly; guest emits RPC).
- **`spawnables.ts`** — register `deck` with `internal: true`.
- **`SpawnableRegistry.ts`** — add `internal?: boolean` field; the spawn modal filters it out.
- **`ContextMenu.tsx`** — render `numeric` menu items.
- **`EntityComponent.ts`** — extend `MenuItem` union.

### New modules

- **`DeckComponent.ts`** — the component itself, plus the menu-item definitions, top/bottom material-binding logic, and `maybeDissolve`.
- **`MergeService.ts`** — `canMerge(a, b)`, `merge(a, b)`, `recheckMergeOverlaps(entity)`. Pure host-side; pulled out of `DeckComponent` so `PhysicsComponent.collide` and `HoldService.release` can both call it without circular imports.

## Testing Decisions

Pure-logic surfaces tested directly; React glue and physics integration deferred to existing manual playtest patterns.

- **`MergeService.test.ts`**:
  - `canMerge` returns false when either party is held.
  - `canMerge` returns false when categories mismatch.
  - `canMerge` returns false when either party has `privateToSeat` set.
  - `canMerge` returns false when at least one party is already in a deck (`isHidden`).
  - `canMerge` returns true for two unheld, same-category, non-private, free cards.
  - `merge` of two cards spawns a deck at the lower card's transform with both cards in `cards`.
  - `merge` of a card and a deck inserts the card at index 0.
- **`DeckComponent.test.ts`**:
  - `onPropertiesChanged({ cards })` updates sibling `MeshComponent.textureRefs.face` to top card's face and `.back` to bottom card's back.
  - `onPropertiesChanged({ cards })` updates `MeshComponent.size` to height-scaled box.
  - `maybeDissolve` triggers when `cards.length === 1`: lone card un-hides at deck pose, deck despawns.
  - `shuffle` Fisher-Yates: smoke-test that the array is permuted and all original ids remain.
  - `draw` pops from front; refuses (no-op) when caller has no main hand.
  - `deal` round-robins clockwise from caller; stops on exhaustion.
- **`isHidden` round-trip**: a `MeshComponent` test that flipping `entity.isHidden` toggles `group.visible`. A `PhysicsComponent` test that flipping `entity.isHidden` adds/removes the body from the world.
- **No React render tests** for the numeric `MenuItem`. Matches existing project convention.

## Out of Scope

- **Empty / spawnable decks** — decks are only born from card↔card collision in slice 1. Empty-deck spawnable adds placeholder mesh, deferred category, and auto-collapse edge cases that aren't load-bearing.
- **Deck↔deck merge** — colliding two decks does nothing in slice 1. A future "stack two decks" feature needs UX to pick which order they combine; not load-bearing.
- **Per-card flip preservation** — a face-down card joining a face-up deck loses its flip state. Drawn cards emerge in the deck's orientation.
- **Riffle / sound shuffle animation** — only the simple wiggle ships. Riffle would spawn temporary card visuals and is significant view work.
- **Scripting API** — `Shuffle`, `Deal`, `Draw` are context-menu-only in slice 1. Scripting hooks land when the scripting layer itself ships.
- **Drawing from non-top of deck** — `Draw` always pulls index 0 ("first" / top). Pulling from the bottom or a specific position is a future feature.
- **Search a deck** (face-up reveal of all contents to one player) — TTS has this; deferred. Privacy machinery would extend cleanly when it lands.
- **Custom deck name editing** — uses the default `Deck of {category}`. Renaming via the editor panel works through existing entity-name flows; no deck-specific UI.

## Further Notes

- The `isHidden` field is intentionally generic — Bags (per `todo.md`'s "Add containers" plan) reuse the same field free. `DeckComponent` is the first consumer; `BagComponent` is the natural second.
- `MergeService` is split out of `DeckComponent` because the same predicate runs from two unrelated seams (physics collide + hold release). Living on `DeckComponent` would force `HoldService` to import the component class; living in its own module avoids a layering violation.
- `PrivacyScrubber` already keys on a per-card `parentId`-style condition for hand cards via `privateToSeat`. Extending it to also key on `parentId → deck` is one new branch in the scrub predicate, not a redesign.
- The visible-top-card-face leak (peers can read the face-up deck's top via the deck mesh's `textureRefs`) is intentional — that's what the user sees at the table. Only buried cards are private.
- `DeckComponent.onPropertiesChanged({ cards })` patches sibling `MeshComponent.size`, which makes the deck visibly grow/shrink. Physics body shape needs to follow — `PhysicsComponent` already rebuilds shape from `MeshComponent.halfExtents()` on certain triggers; verify this re-fires on size patch, otherwise add an explicit rebuild seam.
