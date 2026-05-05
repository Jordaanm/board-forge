# Issues — Decks

Vertical slices for `prd--deck.md`. Each slice is independently demoable and tracer-bullets through every layer it touches.

## Issue #1 — `isContained` foundation ✅ Completed

### What to build

Add a generic `isContained: boolean` field to `Entity`, replicated via the existing entity-patch flow. `MeshComponent` toggles `group.visible` from this field; `PhysicsComponent` adds or removes its `CANNON.Body` from the world on flip. No deck logic yet — this slice is the foundation.

Verifiable end-to-end via a dev/editor toggle: flip `isContained` on a card and watch its mesh disappear and the card stop colliding with dice on the same table.

### Acceptance criteria

- [x] `Entity.isContained: boolean` field, default `false`.
- [x] `wire.ts applyEntityPatch` handles `isContained` patches.
- [x] `MeshComponent` reads `entity.isContained` in `onSpawn` and on patch; sets `group.visible` accordingly.
- [x] `PhysicsComponent` removes its body from `physics.world` when `isContained` flips true; re-adds when it flips false. Body is preserved (not recreated).
- [x] An entity-level seam fans `isContained` changes to subscribed components (e.g., `entity.onIsContainedChanged` or component subscription on entity patch).
- [x] Round-trip test: `MeshComponent.test.ts` verifies `group.visible` toggles with `isContained`. `PhysicsComponent.test.ts` verifies body is added/removed from world.
- [x] No regressions in existing card / hand / dice tests.

### Blocked by

None — can start immediately.

---

## Issue #2 — `DeckComponent` + `prim:deck` mesh + card↔card merge

### What to build

The first user-visible feature. Drop two same-category cards on each other → a deck spawns and both cards disappear inside it.

Three subsystems land together because each is incomplete without the others:

- `DeckComponent` — `cards: string[]`, `category: string`. On `cards` change, patches sibling `MeshComponent.textureRefs` (top card's face → `face` slot, bottom card's back → `back` slot) and `MeshComponent.size` (height = 0.02 × cards.length).
- `prim:deck` mesh in `MeshComponent.buildMesh` — BoxGeometry with face/back/side material slots. Side material renders striped slabs (one per card).
- `MergeService.canMerge` + `merge` for card↔card. Hooked into `PhysicsComponent.collide` event on the host. Spawns a new `deck` entity at the lower (lower-Y) card's transform with both cards' GUIDs in `cards` (newer-arrival = index 0).
- `SpawnableDef.internal?: boolean` flag added; `SpawnObjectModal` filters out internals. `deck` registered with `internal: true`.

`canMerge` predicate gates on: both unheld, both `privateToSeat === null`, both `isContained === false`, matching category. (Hand-resident cards are excluded via `privateToSeat`, covering user story 10.)

### Acceptance criteria

- [ ] `DeckComponent` registered with `typeId: 'deck'`, `requires: ['transform', 'mesh', 'physics']`.
- [ ] `deck` spawnable registered with `internal: true`; absent from spawn modal.
- [ ] `SpawnableDef.internal?: boolean` field added; `SpawnObjectModal` filters it.
- [ ] `prim:deck` builds a striped-side BoxGeometry; height = `0.02 × cards.length`; face/back/side material slot routing matches `prim:card`.
- [ ] `DeckComponent.onPropertiesChanged({ cards })` patches Mesh `textureRefs.face`, `textureRefs.back`, and `size` so the deck visibly grows and shows correct top/bottom.
- [ ] `MergeService.canMerge` returns false when either party is held, in a hand, in a deck, or has mismatched category.
- [ ] `MergeService.merge` (card↔card path) spawns a `deck` entity at the lower card's transform, names it `Deck of {category}` (fallback `Deck-{guid:8}` when category empty), sets both cards' `isContained=true` and `parentId=deck.id`, with the newer card at index 0.
- [ ] Deck physics: mass = `cardMass × cards.length`; hitbox derived from height-scaled box.
- [ ] `PhysicsComponent.collide` host listener calls `MergeService` on contact events.
- [ ] Two same-category cards dropped on each other form a deck. The cards' meshes hide; the deck's mesh shows both faces correctly.
- [ ] Mismatched-category collision does not merge (cards bounce).
- [ ] Tests: `MergeService.test.ts` covers each `canMerge` branch and the card↔card `merge` outcome. `DeckComponent.test.ts` covers material/size patching on `cards` change.

### Blocked by

- Blocked by #1.

---

## Issue #3 — Card↔deck merge

### What to build

Drop a card on an existing deck (same category) → card joins the deck at index 0. Deck height grows by one slab; the new card's face becomes the visible top.

Extends `MergeService.merge` with the card↔deck branch: card's `isContained=true`, `parentId=deck.id`; insert at `cards[0]`. Deck's transform is unchanged. Same `canMerge` predicate from issue #2 applies — already excludes the held / mismatched-category cases.

This also covers user story 11 (drag a card from the hand panel onto a deck on the table) — `playCardToTable` tweens to the cursor; if the card lands on the deck, normal collision-merge fires.

### Acceptance criteria

- [ ] `MergeService.merge` handles `(card, deck)` — card inserted at `cards[0]`, deck transform unchanged.
- [ ] Deck mesh re-renders with the new card's face on top after merge.
- [ ] Mismatched-category card colliding with a deck does not merge.
- [ ] Card dragged from a hand panel onto a deck (via `playCardToTable`) lands and merges via the same code path.
- [ ] Test in `MergeService.test.ts`: merging a card with a deck produces `cards = [newCardId, ...oldCards]`.

### Blocked by

- Blocked by #2.

---

## Issue #4 — Hold-release merge recheck

### What to build

Fix the gap where releasing a held card already in contact with a deck doesn't re-fire `beginContact` and so silently fails to merge.

Extend `HoldService` release path to call `MergeService.recheckMergeOverlaps(entity)`, which walks the entity's current cannon contact list and runs the same merge logic against each contacted entity.

### Acceptance criteria

- [ ] `MergeService.recheckMergeOverlaps(entity)` iterates current contacts and calls `merge` for any pair passing `canMerge`.
- [ ] `HoldService.release` calls `recheckMergeOverlaps` on the released entity (host only).
- [ ] Manual test: pick up a card, drag it onto a deck, release while still in physical contact → merge fires.
- [ ] Manual test: pick up a deck, sweep over a settled card, release while in contact → merge fires (covers user story 8 inverse — held suppresses, release fires).
- [ ] Held card's release that lands on nothing is unaffected.

### Blocked by

- Blocked by #3.

---

## Issue #5 — Privacy scrub for in-deck cards

### What to build

Extend the `PrivacyScrubber` (in `HostReplicatorV2` or wherever the per-peer patch egress lives) so that a card whose `parentId` resolves to a `deck` entity has its `face` and `back` blanked in patches sent to all non-host peers. Host retains the real values; peers see only the visible top/bottom via the deck mesh's `textureRefs` (which are public — the visible state is intentionally not scrubbed).

### Acceptance criteria

- [ ] `PrivacyScrubber` predicate: scrub `CardComponent.face` / `back` when the card's `parentId` is set and resolves to an entity with a `DeckComponent`.
- [ ] Host's local card state remains real (not blanked).
- [ ] Peer's mirrored card state has empty `face` / `back`.
- [ ] The deck's own `MeshComponent.textureRefs` (top/bottom slots) are not scrubbed — the visible top is always public.
- [ ] Test in the privacy-scrub test suite: an in-deck card's `face` is `''` in a patch destined for a non-host peer; `face` is real in the host's local state.

### Blocked by

- Blocked by #2.

---

## Issue #6 — Draw 1 + singleton dissolution

### What to build

Right-click a deck → `Draw` (single-action menu item, no count selection yet). Pops `cards[0]`, un-hides it, tweens it into the caller's main hand, re-emits its `face`/`back` so the new owner receives the real values (privacy handoff).

After every removal, host runs `maybeDissolve()`: if `cards.length === 1`, synchronously un-hide the lone card at the deck's pose with zero velocity and despawn the deck.

`Draw` menu item is greyed out when the caller has no main hand. Gates on `canManipulate(ctx, deck.owner)`.

Wire: new `{ type: 'draw-from-deck', deckId, count: 1 }` RPC. Host validates, runs the draw.

### Acceptance criteria

- [ ] `DeckComponent.onContextMenu` returns a `Draw` action item; greyed out (`disabled: true`) when `mainHandFor(callerSeat)` is null.
- [ ] Action gates on `canManipulate(ctx, entity.owner)`.
- [ ] Host `drawFromDeck(deckId, count)`: pops `min(count, cards.length)` from front of `cards`. For each: clear `isContained`, clear `parentId`, set transform to deck's top pose, call `world.tweenIntoHand(card, mainHandId)` (250ms), then `card.setState({ face, back })` to trigger privacy re-emit.
- [ ] `maybeDissolve` runs after the pop loop. If `cards.length === 1`: un-hide lone card at deck pose, zero velocity (`body.velocity` and `body.angularVelocity`), despawn deck.
- [ ] Guest emits `{ type: 'draw-from-deck', deckId, count: 1 }`; host validates.
- [ ] `DeckComponent.test.ts`: `draw` pops from front; refuses (no-op) when caller has no main hand; `maybeDissolve` triggers correctly when down to 1.
- [ ] Manual test: form a 3-card deck, draw 1 → 2-card deck. Draw again → 1 → dissolve.
- [ ] Privacy: drawn card shows correct face in caller's hand UI; other peers receive only the hand-blanked face (existing hand privacy handles this).

### Blocked by

- Blocked by #3, #5.

---

## Issue #7 — Shuffle + wiggle

### What to build

Right-click a deck → `Shuffle` (single-action menu item). Host runs Fisher-Yates on a copy of `cards` and patches via `setState`. The deck plays a 200ms rotation-jitter tween for visual feedback. Top/bottom material binding refreshes automatically via the `cards`-change handler from issue #2.

Gates on `canManipulate(ctx, deck.owner)`. Wire: `{ type: 'shuffle-deck', deckId }` RPC.

### Acceptance criteria

- [ ] `DeckComponent.onContextMenu` returns a `Shuffle` action item.
- [ ] Action gates on `canManipulate(ctx, entity.owner)`.
- [ ] Host `shuffleDeck(deckId)`: Fisher-Yates on `cards`, `setState({ cards: shuffled })`.
- [ ] 200ms `TweenComponent` rotation jitter plays after the patch.
- [ ] Visible top texture changes match the new top card after shuffle.
- [ ] Guest emits `{ type: 'shuffle-deck', deckId }`; host validates.
- [ ] `DeckComponent.test.ts`: shuffle smoke-test — array is permuted, all original ids remain.

### Blocked by

- Blocked by #2.

---

## Issue #8 — Numeric `MenuItem` kind + submenu rendering

### What to build

Extend the `MenuItem` discriminated union with a `numeric` kind:

```ts
| { kind: 'numeric'; id: string; label: string; min?: number; max?: number; default?: number }
```

`ContextMenu.tsx` renders this as a small numeric input + confirm button; on submit, dispatches `onAction(id, { value: number })`. Pattern follows the existing `colorpicker` precedent.

If submenu support isn't already in `MenuItem`, add a `submenu` kind too — `Draw ▸ {1,2,3,5,Other...}` needs a child list.

Convert `DeckComponent`'s `Draw` menu item from issue #6 from a flat action to `Draw ▸ {1, 2, 3, 5, Other...}`. The numeric `Other...` takes a count input.

### Acceptance criteria

- [ ] `MenuItem` union extended with `numeric` (and `submenu` if absent).
- [ ] `ContextMenu.tsx` renders numeric inputs with min/max/default and submit-on-Enter.
- [ ] `DeckComponent.onContextMenu` returns `Draw ▸ {1, 2, 3, 5, Other...}` when caller has a main hand; greyed out otherwise.
- [ ] Selecting `Draw 3` calls `drawFromDeck(deckId, 3)`.
- [ ] Selecting `Other...` and entering 7 calls `drawFromDeck(deckId, 7)`.
- [ ] Manual test: numeric input is keyboard-focusable and confirms via Enter.

### Blocked by

- Blocked by #6.

---

## Issue #9 — Deal N

### What to build

Right-click a deck → `Deal ▸ {1, 2, 3, 5, Other...}`. Host builds the recipient list (seats with a main hand, ordered clockwise from the caller, caller first) and runs N rounds of round-robin deals. If the deck runs out mid-deal, stops where it ran out.

Per-card tween is the standard 250ms `tweenIntoHand`; cards are scheduled with an 80ms stagger between each (`(round * recipients.length + i) * 80ms`).

`maybeDissolve` runs after the last scheduled tween. Same privacy re-emit handoff per card as `Draw` (issue #6 covers this — same code path).

Gates on `canManipulate(ctx, deck.owner)`. Wire: `{ type: 'deal-from-deck', deckId, count }` RPC.

### Acceptance criteria

- [ ] `DeckComponent.onContextMenu` returns `Deal ▸ {1, 2, 3, 5, Other...}`.
- [ ] Action gates on `canManipulate(ctx, entity.owner)`.
- [ ] Host `dealFromDeck(deckId, count)`:
  - Builds recipients = seats with a main hand, ordered clockwise from caller (caller first).
  - Runs `count` rounds; per round, per recipient, pops top card and schedules `tweenIntoHand` with the staggered delay.
  - If `cards.length === 0` mid-deal, breaks the loop.
  - Calls `maybeDissolve` after scheduling.
- [ ] Per-card privacy re-emit (matches issue #6 path).
- [ ] Guest emits `{ type: 'deal-from-deck', deckId, count }`; host validates.
- [ ] `DeckComponent.test.ts`: deal round-robins clockwise from caller; stops on exhaustion; correct cards land in correct hands.
- [ ] Manual test: 2+ seated players with main hands, form a 10-card deck, `Deal 3` → 6 cards distributed in clockwise order, deck has 4 left.
- [ ] Manual test: 3 seated players, form a 5-card deck, `Deal 2` → 5 cards distributed, deck dissolves on the 5th deal (last card un-hides).

### Blocked by

- Blocked by #6, #8.
