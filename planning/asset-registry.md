# Asset Registry / Manifest System

## Problem

Assets (images, 3D models, sounds) are currently referenced as raw URL strings inline in component state (`MeshComponent.textureRefs`, `Skydome.textureUrl`, `Card.face`/`back`, `Board.textureUrl`). No registry exists, so:
- Clients can't preload — assets fetch lazily on first reference.
- No reuse: the same cardback URL is loaded N times.
- No central failure path: rotted URLs silently break entities.
- No picker UX: the property editor exposes a `<input type="text">` for URLs.

## Goals

A two-manifest catalog of assets, referenced by slug, with preload control, fallback-on-failure, host-driven editing, and picker widgets in the property editor.

## Decisions

### Storage & references

1. **Catalog only.** Manifest entries hold URLs + metadata, not bytes. No blob-encoding inside the save file; no DataChannel asset transfer.
2. **Mixed source URLs.** Base manifest = app-served (AWS bucket / CDN). Custom manifest = arbitrary public URLs. CORS preflight runs at add-time so a busted URL fails loudly, not silently on a guest's join later.
3. **URL-or-slug refs accepted everywhere.** Any field that takes an asset accepts either a slug (`custom:ace-of-spades`) or a raw URL (`https://…`). `AssetService.resolve(refOrUrl)` detects the prefix. No forced migration of existing URL-having components. Unblocks future dynamic asset loading via scripts.

### Identity & schema

4. **Namespaced slugs.** `base:cards/standard-back`, `custom:ace-of-spades`. Slug *is* the ID. **Immutable after creation.** Display name is a separate, editable field. Base slugs become a stable public contract; renaming them breaks saves, treated like an API.
5. **Three flat types.** `image`, `model`, `sound`. No subdivision (no separate `texture`/`icon`/`skybox`); the consumer interprets. Schema:
   ```ts
   {
     slug:         string;   // immutable, namespaced (base:foo, custom:foo, prim:foo)
     name:         string;   // editable display name
     type:         'image' | 'model' | 'sound';
     url:          string;
     preload:      boolean;
     description?: string;
     tags?:        string[];
   }
   ```
6. **Primitives become a synthetic manifest.** `prim:cube`, `prim:d6`, `prim:card`, `prim:deck`, `prim:meeple` are registered as catalog entries (type: `model`, `preload: true`, special URL or marker). MeshComponent's resolver becomes a single asset lookup. Picker exposes Primitives as a third tab.

### Loading

7. **Centralized `AssetService`.** Single load funnel with `Map<slug, { url, status, asset }>` cache. Dedupes by slug; falls back to URL-keyed dedup for raw-URL refs. Replaces ad-hoc `new THREE.TextureLoader().load(...)` in `MeshComponent.applyMaterialAttributes`.
8. **Explicit `preload` flag drives strategy.** No critical-path inference. Defaults differ per manifest: base default `false` (don't bulk-load a curated library), custom default `true` (host curated this list, probably wants it loaded). At session start, AssetService preloads everything where `preload: true`; everything else is lazy on first reference.
9. **Non-blocking UI.** Entities render with the type-default placeholder, swap to real asset on resolve. Small "loading N assets…" toast. Scene entry never blocks on preload.

### Resilience

10. **Type-default fallbacks + warning badge.** Three placeholders shipped under stable base slugs (`base:placeholder/image`, `base:placeholder/model`, `base:placeholder/sound`). Any failure path — 404, CORS denial at load time, wrong content-type, slug not in manifest — collapses to "swap to type default + flag asset as broken in editor UI." No per-entry fallback declarations. No last-known-good cache for PoC (revisit as a separate offline/caching feature).

### Editing & replication

11. **Hybrid editing.** Host edits manifest as a local **draft**. Explicit "Push to peers" button publishes the **draft** as a new full-snapshot **published** state. Wire = single replace-whole-snapshot message. New joiners receive last-published. Cache invalidates on push for slugs whose URL changed; entities re-resolve. No per-edit wire messages, no diffing.
12. **Save = draft (host's full state).** Save file persists draft, not published. Auto-save (every few seconds) snapshots draft. Reload-from-save effectively re-publishes draft on session start. Resolves the unpushed-changes-with-entity-refs footgun.
    - Side effect: a peer reconnecting from auto-save after a host crash sees host's last draft as published. Implicit "push on crash." Acceptable for PoC; session continuity through host crash is already best-effort.

### UI

13. **Manager modal.** Dedicated, opened from a button in `HostActionBar` next to `ScriptEditorModal`. Full CRUD over the custom manifest (add / edit / delete / reorder), Push-to-peers button, status row showing N unpushed changes. Primitives + Base tabs read-only.
14. **Picker modal.** Separate, lightweight, opens from property rows. Tabs: Primitives | Base | Custom | URL paste. Grid of thumbnails, type-filtered to the property's slot, with search + tag filter. Returns slug (Primitives/Base/Custom) or raw URL (URL tab) on select.
15. **Property editor changes.** `PropertyDef` gains asset types: `'asset:image' | 'asset:model' | 'asset:sound'`. Replaces `'string'` for `Skydome.textureUrl`, `Board.textureUrl`, `Card.face`/`back`, etc. Property rows render `[thumbnail] AssetName ▼  [×]`; click opens picker, × clears.

### Scripting

16. **Read-only API.** Scripts get:
    ```ts
    scene.assets.get(slug):  AssetEntry | null
    scene.assets.list(opts?: { type? }): AssetEntry[]
    scene.playSound(slug):   void   // broadcast-replicated
    ```
    No script-side manifest mutation. Texture/model use is implicit: scripts write slug strings into entity component state, AssetService resolves on render. `scene.playSound` lives on the scene itself (not the asset object) to keep the replication path simple. Future "scripts register assets at runtime" is opened by the URL-or-slug ref accepting URLs without manifest entries (Q8).

## Out of scope (PoC)

- Bytes-in-manifest / DataChannel asset transfer.
- File-upload UI (host pastes URLs; "Upload" button → app-hosted URL is a later addition, no schema change required).
- Per-entry custom fallback declarations.
- Last-known-good blob cache (IndexedDB).
- Live mid-session editing without an explicit Push step.
- Script-side manifest mutation.
- Asset variants / LODs / multi-resolution.
- Stored derived metadata (dimensions, duration, color space) — derived at load time.
