# Spritesheet asset type — design

Adds a new `AssetType: 'spritesheet'` for grid-laid-out sub-images addressed via 3-segment slugs (`custom:deck:0`). Motivating use case: 1-image card decks (back + 52 faces). Deck-builder utility tool is a separate follow-up that consumes this type.

## Asset model

- New `AssetType: 'spritesheet'`.
- `AssetEntry` gains optional flat `cols?: number; rows?: number`. Required iff `type === 'spritesheet'`; validator enforces both integers ≥1, and rejects when set on non-spritesheet entries.
- cols/rows mutable after creation. URL also mutable (existing behavior). Sprite refs are best-effort across grid edits — same risk profile as URL changes.

## Ref grammar

- Slug regex extended: `^<ns>:<body>(:<index>)?$`, where index is `\d+`.
- Sheet slug = 2-segment (`custom:deck`); sprite ref = 3-segment (`custom:deck:0`).
- 3-segment refs are **not** Manifest entries — synthetic, emitted by the picker, resolved by AssetService.
- Row-major, top-left origin: `col = i % cols`, `row = floor(i / cols)`.
- UV math (with THREE default `flipY=true`):
  ```
  offset.x = (i % cols) / cols
  offset.y = 1 - (floor(i / cols) + 1) / rows
  repeat.x = 1 / cols
  repeat.y = 1 / rows
  ```

## AssetService

- `subscribe(spriteRef, 'image', listener)` returns `THREE.Texture` exactly like a plain image — caller stays unaware it's a sprite.
- Internal: parent sheet image fetched once (cache key = sheet slug + internal marker, e.g. `:_sheet`). Each sprite-ref cache entry holds a `texture.clone()` with `offset`/`repeat` set from index/cols/rows.
- Cloned texture config: `minFilter = LinearFilter`, `magFilter = LinearFilter`, `generateMipmaps = false`. Same settings applied to parent sheet load so the source image never builds a mip chain (prevents cross-cell bleed at small render sizes).
- Out-of-bounds index, non-integer suffix (`custom:deck:abc`), missing parent sheet → `broken` status + magenta placeholder. Consistent with existing unknown-slug handling.
- `preload: true` on a sheet entry fetches the underlying sheet image at session start. Sprite-ref cache entries created lazily on first `subscribe()`; the clone+offset step is cheap and runs synchronously once the parent is loaded.
- `pendingCount` ticks for the sheet fetch only, not per sprite ref.

## AssetManagerModal (host editor)

- AddRow `type` selector appends `spritesheet` after `image | model | sound`.
- When `type === 'spritesheet'` is selected, two conditional rows appear below `preload`: `Cols` and `Rows` (number inputs). Defaults `1`/`1`.
- EditRow shows cols/rows fields editable for spritesheet entries (consistent with Q7 — mutable post-creation).
- Existing warning badge (`useAssetStatus`) surfaces broken sprite refs the same as broken images/models/sounds.

## AssetPicker

- Sheet appears as a single tile in the `type='image'` filter, **Custom tab only** (no base/primitive spritesheets).
- Click sheet tile → in-place body swap to sprite sub-grid with breadcrumb back. Tab bar and URL tab hidden during drill-in.
- Sprite sub-tiles labeled by index (`0`, `1`, `2`, …). Thumbnail rendered via CSS `background-image: url(sheet); background-position: -col*W -row*H; background-size: (cols*W) (rows*H)` against a fixed-size box — no canvas crop needed.
- Sheet tile **never** emits its 2-segment slug as a selection. Only the drilled-in sprite tile emits `custom:sheet:N`.
- Pre-selection: if `currentRef` is `custom:sheet:N`, top-level shows the sheet tile selected. After drill-in, sprite N is pre-highlighted. No auto-drill — user clicks once to enter.
- Escape closes the modal entirely. No two-level Escape semantics; click the breadcrumb to return to the asset list.

## Wire / save

- `AssetEntry.cols`/`rows` ride existing `ManifestStore` push replication.
- Entity properties store sprite refs as plain strings — no save-format changes.
- Existing `validateSlug` callers (manifest add, picker URL paste, save load) accept 3-segment refs once the regex is extended.

## Out of scope

- **Deck-builder utility tool** — separate follow-up. Will consume the spritesheet type to spawn N Card entities + a Deck entity with the right face/back sprite refs wired up.
- **Per-sprite naming** (e.g. `custom:deck:ace-spades`) — deferred. Indices only for now. Adding named cells later is additive.
- **Per-sheet filter knob** (e.g. `'nearest'` for pixel art) — deferred. All sheets currently use Linear + no mipmaps. Revisit if pixel-art use case appears.
- **Scripting helpers** (`Assets.spritesOf(slug)`) — deferred. Scripts auto-receive `cols`/`rows` via `.dts` regeneration and can compute refs with a two-line loop. Easy to add later; hard to remove.
- **URL-tab support for spritesheets** — the URL tab continues to emit raw URLs only. Sheets require structured cols/rows metadata that can't be supplied by a paste.
