# Issues — Spritesheet asset type

Source: [prd--sprite-sheet.md](./prd--sprite-sheet.md)

Six vertical slices. Build in dependency order. Each slice is independently grabbable once its blockers land.

---

## Issue 1 — Pure helpers: sprite-ref parser + UV math ✅ DONE

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 2, 11

### What to build

Two pure modules with unit tests, no integration. Single source of truth for the 3-segment ref grammar and the UV-mapping convention; consumed by later slices.

- `spriteRef.ts` — pure module exporting:
  - `parseRef(str)` → `null | { kind: 'slug'; namespace; body } | { kind: 'sprite'; sheetSlug; index }`
  - `serializeSpriteRef(sheetSlug, index)` → string
  - No I/O, no THREE dependency.
- `spriteUV.ts` — pure function `spriteUV(index, cols, rows)` → `{ offsetX, offsetY, repeatX, repeatY }`. Encodes the row-major / top-left / flipY convention (named, documented).

### Acceptance criteria

- [x] 2-segment slugs round-trip through `parseRef` unchanged
- [x] 3-segment refs parse to `{ sheetSlug, index }`
- [x] Non-integer tail, negative index, and unknown namespace are rejected
- [x] `serializeSpriteRef` ∘ `parseRef` round-trips
- [x] `spriteUV` returns the documented offset/repeat for: corner cells (0, `cols-1`, `cols*(rows-1)`, `cols*rows - 1`), 1×1 degenerate grid, square and non-square grids
- [x] Unit tests for both modules, no integration tests yet

### Blocked by

None — can start immediately.

---

## Issue 2 — Manifest + scripting types support `spritesheet` ✅ DONE

**Type:** AFK
**Blocked by:** #1
**User stories covered:** 1, 6, 16, 24

### What to build

Extend `Manifest` and the scripting type surface to recognize `spritesheet` as an asset type carrying `cols`/`rows`. No runtime resolution yet — that's slice #3.

- `AssetType` union adds `'spritesheet'` ([packages/client/src/assets/Manifest.ts](../packages/client/src/assets/Manifest.ts))
- `AssetEntry` gains optional `cols?: number; rows?: number`
- `validateEntry`: both fields required as positive integers iff `type === 'spritesheet'`; rejected otherwise
- `validateSlug` / `isSlug`: regex extended to allow an optional `:\d+` tail (using the parser from #1)
- `Manifest.update`: `slug` / `type` remain immutable; `cols` / `rows` are mutable
- Regenerate [script-globals.dts](../packages/client/src/scripting/script-globals.dts) from [script-globals-types.ts](../packages/client/src/scripting/script-globals-types.ts) — `AssetType` and `AssetEntry` pick up the new fields
- Spritesheet entries restricted to `custom:` namespace (no `base:` / `prim:` sheets)

### Acceptance criteria

- [x] `Manifest.test.ts` covers: add/update of spritesheet entries, cols/rows required as integers ≥1, rejected on non-spritesheet types, cols/rows mutable on update, slug/type immutable on update
- [x] `add('base:sheet', { type: 'spritesheet', … })` rejected
- [x] Existing image/model/sound tests still pass unchanged
- [x] `script-globals.dts` regenerated and committed; `Assets.get('custom:deck')` typed to return `AssetEntry` with optional `cols`/`rows`
- [x] No consumer of `AssetEntry` regresses (forward-compatible: pre-spritesheet consumers ignore the new fields)

### Blocked by

- Blocked by #1

---

## Issue 3 — AssetService resolves 3-segment refs to cloned textures

**Type:** AFK
**Blocked by:** #1, #2
**User stories covered:** 7, 9, 10, 11, 12, 19, 20, 22

### What to build

Teach [AssetService](../packages/client/src/assets/AssetService.ts) to resolve sprite refs through the existing `subscribe(ref, 'image', listener)` path. No consumer site changes required.

- `subscribe(ref, 'image', …)` uses the parser from #1 to detect 3-segment refs
- On first sprite-ref subscription, ensure the parent sheet's underlying image is fetched (internal cache key disjoint from any user-facing slug)
- Parent sheet load sets `generateMipmaps = false` and `minFilter = LinearFilter` **before** GPU upload
- Per-sprite cache entries created **lazily** on first subscribe (not eagerly per index)
- Each sprite ref gets a `texture.clone()` (shared underlying source) with `offset` / `repeat` from `spriteUV` (#1)
- `preload(manifests)` walks `'spritesheet'` entries and triggers exactly one fetch per sheet
- `invalidate(sheetSlug)` re-fires all sprite-ref subscribers for that sheet
- Failure modes route to existing `broken` status + magenta placeholder:
  - Out-of-bounds index
  - Missing parent sheet entry
  - Deleted/grid-shrunk parent
- CORS preflight ([corsPreflight.ts](../packages/client/src/assets/corsPreflight.ts)) covers sheet URLs without modification

### Acceptance criteria

- [ ] `subscribe('custom:deck:0', 'image', …)` fires `loaded` and supplies a `THREE.Texture` whose `offset` / `repeat` match `spriteUV(0, cols, rows)`
- [ ] Two sprite refs to the same sheet share one fetch — fake imageLoader asserted called once
- [ ] `preload` of a manifest containing a spritesheet entry triggers exactly one fetch for the sheet
- [ ] `invalidate(sheetSlug)` re-fires all sprite-ref subscribers
- [ ] Out-of-bounds index, missing parent, and grid-shrunk-out refs all fire `broken`
- [ ] Tests follow the `AssetService.test.ts` pattern: subscribe through public API, assert what the listener receives, never inspect internal cache maps
- [ ] No changes required at consumer sites (CardComponent, ButtonImagesPatch, StickerOpts.image, MeshComponent) — verified manually by binding a Card's `face` to `custom:deck:0` with a hand-crafted manifest entry

### Blocked by

- Blocked by #1
- Blocked by #2

---

## Issue 4 — AssetManagerModal creates/edits spritesheet entries

**Type:** AFK
**Blocked by:** #2
**User stories covered:** 1, 6, 13

### What to build

Extend the Custom tab in [AssetManagerModal](../packages/client/src/components/AssetManagerModal.tsx) so hosts can register a sheet from the existing UI — no separate creation flow.

- `AddRow` `type` `<select>` appends `spritesheet`
- `cols` / `rows` number inputs render conditionally in the field grid below `preload` when type is spritesheet
- `EditRow` exposes the same fields for spritesheet entries
- Existing `useAssetStatus` / warning-badge wiring unchanged (works without modification)
- Primitives / Base tabs never list spritesheet entries (covered by the namespace restriction in #2)

### Acceptance criteria

- [ ] AddRow: selecting `spritesheet` reveals `cols` / `rows` inputs; both required, positive integers
- [ ] EditRow: existing spritesheet entry shows editable `cols` / `rows`; saving applies immediately with no warning/scan
- [ ] Switching the type away from spritesheet hides/clears the cols/rows fields
- [ ] CORS preflight warning surfaces for sheets the same way it does for plain images
- [ ] Primitives and Base tabs remain free of spritesheet entries

### Blocked by

- Blocked by #2

---

## Issue 5 — AssetPicker drill-in for spritesheet sub-grid

**Type:** AFK
**Blocked by:** #3, #4
**User stories covered:** 3, 4, 5, 8, 17, 21, 23

### What to build

Add an in-place drill-in mode to [AssetPicker](../packages/client/src/components/AssetPicker.tsx) so a sheet shows as one tile in the top-level grid and expands to a sub-grid on click. No nested modals — body swap in the same `<Dialog>`.

- Local state machine: `mode: 'list' | { kind: 'sheet'; slug }`
- `'list'` mode: existing rendering unchanged; sheet tiles in the top grid use a click-handler that switches to drill-in instead of emitting the ref
- `'sheet'` mode: tab bar and URL tab hide; body renders an N-tile sub-grid using CSS background positioning of the already-loaded sheet URL (no per-cell canvas work); breadcrumb in the header navigates back
- Sprite tile click calls existing `pick(spriteRef)` via `onSelect(spriteRef)` — emits and closes
- `currentRef` parser (from #1) seeds top-level highlight on the sheet **and** the drill-in highlight on the index when the picker reopens on an existing sprite ref
- Single-asset slot (Card `face`/`back`, Button surface, Sticker image, etc.) refuses a 2-segment sheet slug — picker won't emit it
- URL tab continues to accept raw URLs only — no sheet creation through paste

### Acceptance criteria

- [ ] Clicking a sheet tile in the top-level grid swaps the picker body to the sub-grid without closing the dialog
- [ ] Sub-grid tiles render via CSS `background-image` + `background-position` on the sheet URL (no per-cell canvas/draw work)
- [ ] Breadcrumb header navigates back to the top-level list
- [ ] Clicking a sprite tile calls `onSelect('custom:deck:N')` and closes the picker
- [ ] Reopening the picker with `currentRef='custom:deck:5'` highlights both the sheet (top-level) and sprite 5 (drill-in)
- [ ] Single-asset property pickers refuse a 2-segment sheet slug as a selection (cannot bind a card face to a whole sheet)
- [ ] URL tab continues to emit raw URLs only — verified by inspection

### Blocked by

- Blocked by #3
- Blocked by #4

---

## Issue 6 — End-to-end smoke test: card deck

**Type:** HITL
**Blocked by:** #5
**User stories covered:** 14, 15, 18 (verification of replication, save round-trip, CORS surfacing)

### What to build

Manual verification of the motivating flow. No code — this issue exists to record the test plan and capture results.

Flow:
1. Open the Asset Manager, paste the standard 13×4 deck-of-cards image (52 + back), set type=spritesheet, cols=13, rows=5 (or 8×7 with 3 unused cells), preload=true
2. Spawn one Card entity
3. Open the picker on the Card's `face` property, drill into the sheet, pick index 0 (ace-spades)
4. Verify the card renders with the ace-spades face — no halo bleed from adjacent cells
5. Save the game, reload, verify the Card still renders the same face (sprite ref round-trips as a plain string)
6. Open a second browser window as a guest, verify the sheet replicates automatically and the same card renders for the guest
7. Shrink the sheet's `rows` to break the existing sprite ref, verify the card falls back to the magenta placeholder
8. Use a CORS-failing sheet URL, verify the existing preflight warning surfaces the same way it does for plain images

### Acceptance criteria

- [ ] Host flow: paste → cols/rows → spawn Card → pick face → render
- [ ] No visible halo / cross-cell bleed at low render sizes
- [ ] Save → reload preserves sprite ref (entity property is a plain string)
- [ ] Guest in a second window sees the same sheet and the same card face
- [ ] Grid shrink → magenta placeholder fallback on broken ref
- [ ] CORS-failing sheet URL surfaces the preflight warning

### Blocked by

- Blocked by #5
