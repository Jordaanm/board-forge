# PRD: Spawn Object Menu

## Problem Statement

As host, I want to spawn objects into the scene from a discoverable, searchable menu instead of clicking one of three hardcoded buttons in the editor panel. The current `EditorPanel.SpawnSection` exposes only `board`, `die`, and `token` even though `card` already ships in the registry, and there's no path to grow this list (built-in or user-scripted) without editing the panel.

## Solution

A host-only "Spawn Object" trigger sits in a new top-center action bar. Clicking it opens a centered modal. The modal lists every registered spawnable, grouped by category when no query is active, or as a flat ranked list while typing a search. Selecting an item spawns it via `World.spawn` at a random table-surface position. The modal stays open for batch spawning.

The 3-button spawn row in `EditorPanel.SpawnSection` is removed. "Roll All Dice" stays.

## User Stories

1. As a host, I want a single, persistent "Spawn Object" button at the top of the screen, so that I always know where to spawn things from regardless of which panels I have open.
2. As a host, I want the spawn menu to live in a modal, so that the canvas behind it is unambiguously paused while I'm picking what to spawn.
3. As a host, I want all currently-registered spawnables visible in the modal, so that I can discover new options as the registry grows (including `card`, which is currently registered but not exposed in the UI).
4. As a host, I want spawnables grouped by category (Boards / Dice / Tokens / Cards) when I haven't typed anything, so that I can browse by kind.
5. As a host, I want a search input autofocused when the modal opens, so that I can start typing immediately without grabbing the mouse.
6. As a host, I want substring search on label, so that I can find a spawnable by typing part of its name.
7. As a host, I want search to also match category, type id, and default tags, so that typing "die" or "card" surfaces the right items even if they aren't named that way.
8. As a host, I want results ranked so the most relevant match appears first (label-prefix > label-substring > tag/category/type match), so that the obvious choice is always at the top.
9. As a host, I want arrow keys to navigate the result list and Enter to spawn, so that I can spawn entirely from the keyboard.
10. As a host, I want clicking a result to spawn it, so that the mouse path also works.
11. As a host, I want the modal to stay open after spawning, so that I can spawn many objects in a row without re-opening.
12. As a host, I want subtle visual feedback when an item is spawned (a brief row flash), so that I know the spawn registered without a noisy toast.
13. As a host, I want Esc and click-outside to dismiss the modal, so that it gets out of my way fast.
14. As a host, I want the modal portal-rendered with a dark backdrop, so that it visually overlays the scene cleanly.
15. As a host, I want the modal to share the `EditorPanel` palette (dark panel, same fonts/borders), so that it feels like part of the same tool surface.
16. As a guest, I want the spawn button and modal hidden from my UI, so that I don't see host-only controls I can't use.
17. As a host, I want spawned objects to land at a random position on the table surface, matching today's behavior.
18. As a future scripting author, I want any spawnable I register at runtime to appear in the menu under the category I declare, so that user-defined objects are first-class.
19. As a maintainer, I want `SpawnableType` to stop being a closed union, so that registering new spawnables (built-in or scripted) doesn't require editing wire types.

## Implementation Decisions

### Data model

- Add `category: string` to `SpawnableDef`. Required field, no fallback bucket — registration must declare a category.
- Built-in categories on existing spawnables: `board → "Boards"`, `die → "Dice"`, `token → "Tokens"`, `card → "Cards"`.
- Widen `SpawnableType` from a closed union to `string`. The registry is the source of truth.
- `OBJECT_META: Record<SpawnableType, ObjectMeta>` widens to `Record<string, ObjectMeta>`. Lookups become `OBJECT_META[type] ?? <fallback derived from SpawnableDef>`. The spawn menu does not consult `OBJECT_META` at all — it uses `SpawnableDef.label` directly.

### New modules

- **`spawnableSearch`** (deep, pure, testable). Two functions:
  - `groupByCategory(defs): { category: string; items: SpawnableDef[] }[]` — preserves registration order of categories; items inside each group sorted alphabetically by label.
  - `searchSpawnables(defs, query): SpawnableDef[]` — case-insensitive substring on `label`, `category`, `type`, `defaultTags`. Rank tiers (highest first): label-prefix, label-substring, tag/category/type match. Ties broken alphabetically by label. Empty query returns the input unchanged (UI calls `groupByCategory` instead).
- **`HostActionBar`** (React, host-only). Top-center, always visible. Day-one contents: a single "Spawn Object" trigger button. Pattern accommodates future host actions.
- **`SpawnObjectModal`** (React, host-only). Built on `@radix-ui/react-dialog` (new dependency). Headless, accessible, portal-rendered. Fixed 520×600. Dark semi-transparent backdrop. Click-outside / Esc dismiss. Backdrop blocks pointer events to the canvas; camera does not drift while open.

### Modified modules

- **`SpawnableRegistry`**: add `category` to `SpawnableDef`.
- **`spawnables.ts`**: add `category` to each of the four built-in registrations.
- **`SceneState.ts`**: widen `SpawnableType` to `string`.
- **`objectMeta.ts`**: widen the `OBJECT_META` index signature; consumers handle missing entries.
- **`EditorPanel.tsx`**: remove the three spawn buttons from `SpawnSection`, keep "Roll All Dice".
- **`Room.tsx`**: render `HostActionBar` when `isHost` is true; the bar owns the modal-open state.

### Modal behavior

- Search input on top, autofocused on open.
- Empty query → category-grouped sections, in registration order, items alphabetical within section.
- Non-empty query → flat ranked list. Each row shows its category as a dim right-aligned label.
- Arrow keys navigate the visible list (whether grouped or flat). Enter spawns the focused item.
- Click also spawns. Spawn calls existing `World.spawn` (random table-surface placement). Modal stays open.
- Spawned row flashes briefly (~200ms background highlight) for feedback. No toast.
- No open-hotkey for now. Deferred until a global shortcut convention exists.
- Drag-to-place is future work.

### Wiring

- Modal calls `listSpawnables()` directly at render. No subscription yet — switch to a registry event emitter when scripting registers spawnables at runtime.

### New dependency

- `@radix-ui/react-dialog` in `packages/client`.

## Testing Decisions

A good test here exercises the **external behavior** of the pure search module — given a set of `SpawnableDef`s and a query, does it return the correct ordering? — without coupling to React rendering, DOM events, or modal layout.

- **`spawnableSearch`**: unit-tested in `spawnableSearch.test.ts`. Coverage:
  - `groupByCategory` returns categories in registration order, items alphabetical within each.
  - `searchSpawnables` returns prefix matches before substring matches before tag/category/type matches.
  - Tie-break is alphabetical by label.
  - Case-insensitive matching.
  - Empty query returns input unchanged.
  - Matches against `defaultTags`, `category`, and `type` all surface results.
- **No React render tests.** Matches the existing `toolbarHotkey.test.ts` / `spawnables.test.ts` pattern: pure logic is tested, React glue is not.

## Out of Scope

- Open-hotkey for the modal (deferred until a global shortcut convention exists).
- Drag-to-place (place-where-you-drop instead of random table-surface placement).
- Registry event emitter / live updates while the modal is open. The current `listSpawnables()` call at render is sufficient because all built-in spawnables register at startup; runtime registration only matters once scripting lands.
- Per-spawnable thumbnails / icons — text-only rows for now.
- Guest-facing spawn UI. This is host-only.
- Refactoring `OBJECT_META` away. It still serves the property editor and context menu; only the spawn menu is decoupled from it.

## Further Notes

- The widening of `SpawnableType` is overdue independent of this work: `card` is already registered in `spawnables.ts` but missing from `OBJECT_META` and from the union, which means a spawned card entity would crash `EditorPanel`'s `OBJECT_META[o.objectType].label` lookup. This PRD includes the fix because the spawn menu surfaces `card` for the first time.
- `HostActionBar` is introduced as a pattern, not a one-off. Future host actions (e.g. "Reset Scene", "Save Layout") slot in alongside the "Spawn Object" trigger without rearchitecting.
