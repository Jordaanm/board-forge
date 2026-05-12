# User Preferences

Per-player settings persisted in `localStorage`. v1 ships two prefs: `darkMode` and `rotateAmount`.

## Scope

In: context + hook + localStorage persistence + UI (gear trigger + modal).
Out: actual light-mode CSS — `darkMode` is stored and resolved, but has no visual effect yet. Visual theming (CSS variables, inline-style refactor) is a follow-up task.

## State

`<PreferencesProvider>` wraps `Landing`/`Room` inside [App.tsx](../packages/client/src/App.tsx).

```ts
const {
  darkMode,            // 'system' | 'light' | 'dark'
  rotateAmount,        // 15 | 30 | 45 | 90 | 180
  resolvedTheme,       // 'light' | 'dark' (derived)
  setDarkMode,
  setRotateAmount,
  reset,
} = usePreferences();
```

Per-field setters, no reducer. `resolvedTheme` = `darkMode` when `'light'|'dark'`, else result of `prefers-color-scheme` media query (subscribed for live updates).

## Persistence

- Key: `vt:prefs`
- Shape: `{ version: 1, darkMode: 'system'|'light'|'dark', rotateAmount: number }`
- Single key, JSON blob, atomic read/write
- Live writes: every change persists immediately, no Save/Cancel
- `reset()` restores defaults and rewrites storage
- Cross-tab sync: not implemented

### Read-side hardening

Per-field validation with field-level fallback:
- Missing blob → use all defaults
- Corrupt JSON → use all defaults, `console.warn`
- Valid JSON, invalid field → use default for that field only, `console.warn`
- `version > 1` → use defaults, `console.warn` (migrations land when v2 ships)

### Storage failure

Wrap reads/writes in try/catch. On failure: `console.warn` and fall back to in-memory state for the session.

## Prefs

### `darkMode`
- Default: `'system'`
- Values: `'system' | 'light' | 'dark'`
- Resolution: when `'system'`, derive from `window.matchMedia('(prefers-color-scheme: dark)')`, subscribe to changes
- No visual effect in v1

### `rotateAmount`
- Default: `45`
- Values: one of `{ 15, 30, 45, 90, 180 }` (degrees)
- Used later by a Rotate action (per [todo.md](../todo.md))
- Magnitude only; sign is the Rotate action's concern

## UI

- Trigger: gear icon (inline SVG) in `UIPanel anchor="top-right" order={0}` — above `PlayersPanel`
- Modal: Radix Dialog, styling copied from existing modals (e.g. `SpawnObjectModal`)
- Controls:
  - `darkMode`: three-option segmented control (`System` / `Light` / `Dark`)
  - `rotateAmount`: preset chips (`15° / 30° / 45° / 90° / 180°`)
  - Reset-to-defaults button

## File layout

```
src/preferences/
  PreferencesContext.tsx   # provider
  usePreferences.ts        # hook
  storage.ts               # read/write/validate
  types.ts                 # Preferences, DarkMode, etc.

src/components/
  PreferencesModal.tsx     # Radix Dialog
  PreferencesTrigger.tsx   # gear chip
```

## Tests

- `storage.test.ts` — read defaults on missing, fallback on corrupt JSON, per-field fallback on bad values, version handling, localStorage-throws path
- `PreferencesContext.test.tsx` — reads on mount, persists on change, `reset()` restores defaults
- No UI tests (modal is two controls; faster to verify in browser)
