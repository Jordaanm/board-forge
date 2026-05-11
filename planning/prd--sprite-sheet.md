# PRD — Spritesheet asset type

## Problem Statement

A host who wants to bring custom card art (or any grid-of-images content) into a game today must upload one image per face. A 52-card deck is 53 separate images, 53 manifest entries, and 53 round-trips of "paste URL, name it, set slug, push to peers" through the Asset Manager. The host's source material almost always exists as a single sheet — that's how card-art tools, retro sprite packs, and most icon libraries ship — so the platform forces them to splice the sheet manually before importing.

A second problem follows from the first: a deck of cards built this way is fragile. Each card is its own asset entry, the sheet's grid layout exists only in the host's head, and a swap to a different art set means rebuilding all 53 references.

## Solution

A new asset type, `spritesheet`, lets the host register one image plus a `cols`/`rows` grid. The Asset Picker addresses sub-images via 3-segment refs (`custom:deck:0`, `custom:deck:1`, …). Any property that already accepts an image asset (Card face/back, Button surface, Token texture, Sticker image) accepts a sprite ref without modification.

From the host's POV: paste sheet URL once, set cols/rows once, then pick any cell from a sub-grid in the existing Asset Picker. From the consumer's POV: nothing changes — sprite refs resolve to a `THREE.Texture` through the same `AssetService.subscribe` path that plain images use.

The motivating use case is a card deck; the deck-builder utility that consumes this type to spawn N Card + 1 Deck entity in one action is a deliberate follow-up.

## User Stories

1. As a host with a single-image card deck, I want to register the sheet once with `cols`/`rows`, so that I don't have to splice it into 53 separate uploads.
2. As a host, I want sub-images of a sheet to address as `custom:deck:0`, `custom:deck:1`, …, so that the slug format communicates the sheet/index relationship at a glance.
3. As a host building a card, I want the Asset Picker on the card's `face` property to surface the sheet as one tile and let me drill into the sub-grid, so that the picker doesn't get drowned in 53 tiles per deck.
4. As a host drilling into a sheet, I want a breadcrumb back to the asset list, so that I can re-enter the top-level picker without closing and reopening the modal.
5. As a host who's already set a card's face to `custom:deck:5`, I want the picker to highlight the sheet and pre-select sprite 5 when I reopen it, so that I can see the current state without hunting for it.
6. As a host editing an existing sheet's `cols` or `rows`, I want the edit to apply without ceremony (warnings, scans), so that I can iterate on the grid quickly.
7. As a host who shrinks a sheet's grid and breaks a saved game's sprite refs, I want broken refs to render the same magenta placeholder as any other broken asset, so that the failure is visible and recoverable.
8. As a host whose sheet contains card faces and one card back, I want the Card entity's `face` and `back` slots to accept sprite refs in the same property field as plain image refs, so that I don't need a separate "is this a sprite" mode on the entity.
9. As a host setting `preload: true` on a sheet entry, I want the underlying sheet image to be fetched once at session start, so that the first card flip doesn't stall on a network load.
10. As a developer building a Token or Sticker that references a sprite, I want `assetService.subscribe(spriteRef, 'image', listener)` to fire with a `THREE.Texture` exactly like a plain image, so that no consumer site needs spritesheet-specific code.
11. As a developer reviewing the cloned sprite textures, I want each ref to get its own `THREE.Texture` clone (sharing the underlying GPU upload) with `offset`/`repeat` set, so that adjacent meshes don't fight over UV state on a shared instance.
12. As a host viewing a small card on a far-away table, I want sprite textures to render without halos bleeding in from adjacent cells, so that the visual is clean even at low render sizes.
13. As a host using the existing Asset Manager Custom tab, I want the AddRow `type` selector to include `spritesheet` and reveal `cols`/`rows` number inputs when selected, so that I don't have to learn a separate creation flow.
14. As a guest in a host's room, I want the host's pushed spritesheet entry (including its `cols`/`rows`) to replicate automatically and resolve sprite refs locally, so that I see the same cards the host sees.
15. As a host saving a game, I want sprite refs in entity property fields to round-trip as plain strings, so that save files don't need a new schema.
16. As a script author, I want `Assets.get('custom:deck')` to return an `AssetEntry` with `cols`/`rows` populated, so that I can compute `${slug}:${i}` refs in a simple loop without a special API.
17. As a host who picks the same sheet repeatedly, I want sub-grid thumbnails to render via CSS background positioning of the already-loaded sheet image, so that the drill-in view appears instantly without per-cell canvas work.
18. As a host whose sheet URL fails the CORS preflight, I want the existing preflight warning to surface for sheets the same way it does for images, so that I learn about the problem before play starts.
19. As a developer, I want sprite cache entries to be created lazily on first `subscribe()` rather than eagerly per index, so that an unsubscribed 100-cell sheet doesn't allocate 100 listeners.
20. As a developer running headless tests, I want sprite-ref resolution to work through the same dependency-injected loaders as plain images, so that the test pattern in `AssetService.test.ts` extends naturally.
21. As a host trying to set a Card's `back` property to a 2-segment sheet slug (`custom:deck`), I want the picker to refuse the selection, so that I can't accidentally bind a card face to a whole sheet.
22. As a host who deletes a spritesheet entry that some entity still references, I want the consuming entity's texture to fall back to the placeholder, so that I see the breakage and can fix it.
23. As a host opening the Asset Picker's URL tab while filtering for `image`, I want the URL tab to continue accepting raw URLs only (no sheet creation), so that the URL-paste flow stays simple and predictable.
24. As a host, I want `Primitives` and `Base` tabs to never contain spritesheet entries, so that the sheet concept stays confined to user-authored content.

## Implementation Decisions

### Modules built/modified

**New (deep, isolated)**
- **Sprite-ref parser** — a pure module that turns a string ref into either `null`, a `{ kind: 'slug', namespace, body }` shape, or a `{ kind: 'sprite', sheetSlug, index }` shape. Companion serializer that builds a sprite ref from `(sheetSlug, index)`. No I/O, no THREE dependency. Single source of truth for the 3-segment grammar; consumed by AssetService, AssetPicker, and ManifestStore validation.
- **Sprite UV math** — a pure function `spriteUV(index, cols, rows)` returning `{ offsetX, offsetY, repeatX, repeatY }`. Encapsulates the row-major / top-left / flipY convention. Trivial body, but lives in its own file so the convention is named, documented, and unit-tested instead of inlined.

**Modified**
- **Manifest** — `AssetType` union gains `'spritesheet'`. `AssetEntry` gains optional `cols?: number; rows?: number`. `validateEntry` requires both fields as positive integers iff `type === 'spritesheet'`, rejects them otherwise. Slug regex extended to allow an optional `:\d+` tail; `validateSlug` and `isSlug` updated. `Manifest.update`'s immutability rules unchanged for `slug`/`type`; `cols`/`rows` are mutable.
- **AssetService** — `subscribe(ref, 'image', ...)` recognizes 3-segment refs via the sprite-ref parser, ensures the parent sheet's underlying image is fetched (internal cache key disjoint from any user-facing slug), then materializes per-sprite cache entries with `texture.clone()` + offset/repeat from `spriteUV`. Parent sheet load sets `generateMipmaps = false` and `minFilter = LinearFilter` on the source texture. `preload(manifests)` walks `'spritesheet'` entries the same way it walks images — fetches the parent sheet once. Out-of-bounds index, non-integer suffix, missing parent, and grid-shrunk-out refs all collapse to `broken` status + image placeholder via the existing path.
- **AssetManagerModal** — AddRow's `type` `<select>` appends `spritesheet`; cols/rows number inputs render conditionally in the field grid below `preload` when type is spritesheet. EditRow exposes the same fields for spritesheet entries. The existing `useAssetStatus`/warning-badge wiring works without change.
- **AssetPicker** — Drill-in state added to the picker's local state machine: `mode: 'list' | { kind: 'sheet'; slug }`. When in `'list'`, current rendering is unchanged. When in `'sheet'`, tab bar and URL tab hide, body renders a sub-grid of N tiles using CSS background positioning of the sheet URL, breadcrumb in the header navigates back. Sheet tiles in the top-level grid carry a click-handler that switches to drill-in instead of emitting the ref. Sprite tile click calls existing `pick(spriteRef)`. `currentRef` parser detects 3-segment refs and seeds the top-level highlight on the sheet + the drill-in highlight on the index.
- **Script globals generator** — `script-globals.dts` regenerates from `script-globals-types.ts`. The change is mechanical: `AssetType` gets `'spritesheet'`, `AssetEntry` gets the two optional numeric fields. No new methods on `AssetsApi`.

### Architectural decisions

- Sprite refs are **synthetic** — never stored as Manifest entries. The manifest stores parent sheets only; sprite refs are computed at the pick site, serialized into entity property values as plain strings, and parsed back at resolve time.
- The 3-segment grammar is the **only new ref-kind**. No "sprite ref" / "slug" / "URL" trichotomy — sprite refs are slugs, with one optional regex segment.
- AssetService holds **one cache entry per distinct ref**, including per sprite-ref. Each clone is cheap (shared image source). This keeps the listener model uniform with images/models/sounds.
- Texture filtering for spritesheets is **hardcoded** (Linear/Linear/no mipmaps). Pixel-art use case deferred.
- cols/rows are **mutable** post-creation; no in-product safety net. Documented risk for hosts.
- Spritesheet entries live in **`custom:` namespace only**. No `base:`/`prim:` sheets in MVP.
- AssetPicker drill-in uses **in-place body swap** in the same `<Dialog>`. No nested modals.

### Schema / API contracts

- `AssetEntry` JSON shape gains two optional numeric fields. Forward-compatible: pre-spritesheet consumers ignore them.
- ManifestStore push payload format unchanged — it serializes `AssetEntry` directly.
- Save envelope unchanged — entity properties storing sprite refs are still plain strings.
- `assetService.subscribe(ref, 'image', listener)` signature unchanged; sprite-ref behavior is internal.

### Interactions

- AddRow → ManifestStore.editDraft (existing) → push (existing).
- Pick sheet tile → drill-in state swap → pick sprite tile → `onSelect(spriteRef)` → existing property write.
- Card face property bound to `custom:deck:5` → MeshComponent passes ref to AssetService → texture clone with UV offset rendered on the card.

## Testing Decisions

A good test here exercises **external behavior at the module's API boundary**. For the new pure modules, this means feeding strings/numbers and asserting structured outputs — never reaching into class fields or mock implementations. For the modified `AssetService` and `Manifest`, this means subscribing through the public methods and asserting the texture/status the listener observes, never inspecting the internal cache maps. Prior art: `Manifest.test.ts` and `AssetService.test.ts` already follow this pattern — `AssetService.test.ts` injects a fake `imageLoader` and watches what subscribers receive, never peers at the `images: Map`.

**Modules to test (proposed):**

- **Sprite-ref parser** — exhaustive cases: 2-segment slugs round-trip unchanged; 3-segment refs parse to `{ sheetSlug, index }`; non-integer tail rejected; negative index rejected; namespaces enforced; serializer + parser round-trip.
- **Sprite UV math** — known indices on known grids: corner cells (0, `cols-1`, `cols*(rows-1)`, `cols*rows - 1`), 1×1 degenerate grid, square grids, non-square grids. Assert offset/repeat to the exact value.
- **Manifest** — `add`/`update` of spritesheet entries: cols/rows required, integers ≥1, rejected on non-spritesheet types, mutable on update, slug `type` still immutable.
- **AssetService** — `subscribe('custom:deck:0', 'image', ...)` with a fake image loader fires `loaded` and supplies a Texture whose `offset`/`repeat` match `spriteUV(0, cols, rows)`. Out-of-bounds index fires `broken`. Missing parent sheet fires `broken`. Two sprite refs to the same sheet share one fetch (assert loader called once). `preload` of a manifest containing a spritesheet entry triggers exactly one fetch for the sheet. `invalidate(sheetSlug)` re-fires all sprite-ref subscribers.

**Modules not unit-tested (covered by existing patterns or low ROI):**

- AssetManagerModal — UI/state component; existing modal has no test, no need to introduce one for the small conditional-field addition.
- AssetPicker drill-in — same reasoning. Manual smoke-test via dev server.

## Out of Scope

- **Deck-builder utility tool.** Will be a separate PRD. Consumes this asset type to spawn N Card entities + 1 Deck entity bound to the host's chosen sheet, with face/back mappings, position, and shuffle defaults.
- **Per-sprite naming** (e.g. `custom:deck:ace-spades`). Indices only for now. Additive to add later.
- **Per-sheet filter knob** (`'nearest'` for pixel art). All sheets currently use Linear + no mipmaps. Revisit if a pixel-art use case appears.
- **Scripting helpers** (`Assets.spritesOf(slug)` and friends). Scripts auto-receive `cols`/`rows` on `AssetEntry` and can compute refs with a two-line loop. Easy to add later; hard to remove.
- **URL-tab support for spritesheets.** The picker's URL tab continues to emit raw URLs only. Sheets need structured cols/rows metadata that a paste can't supply.
- **Padded gutters / texture-array implementation.** The Linear/no-mipmap strategy is the MVP solution for cross-cell bleed. Texture arrays or gutter-baking are future work if visual issues arise.
- **Base / Primitive spritesheets.** Spritesheets are user-content only.

## Further Notes

- `texture.clone()` in THREE shares the underlying `Image`/`source` — exactly what's wanted for memory efficiency. Per-clone `needsUpdate`, `magFilter`/`minFilter`, and `offset`/`repeat` are independent.
- Setting `generateMipmaps = false` only takes effect if the source texture hadn't already built a mip chain. The parent sheet's load path must therefore set this *before* the first GPU upload, not on the clone after the fact.
- The Card entity's [face/back properties already use `asset:image`](packages/client/src/entity/components/CardComponent.ts) — once sprite refs resolve through `AssetService` they require zero Card-side changes. Same applies to ButtonImagesPatch, StickerOpts.image, and any other `asset:image` property in the scripting surface.
- Existing CORS preflight ([corsPreflight.ts](packages/client/src/assets/corsPreflight.ts)) covers spritesheet URLs without modification — the probe is URL-shape-agnostic.
- The motivating end-to-end flow as a smoke test: paste a standard 13×4 deck-of-cards image (52 + back), set cols=13 rows=5 (or 8×7 with 3 unused cells), spawn one Card entity, open the picker on `face`, drill into the sheet, pick index 0 (ace-spades), see the card render with that face. Manual verification only.
