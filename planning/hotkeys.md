# Hotkeys

Add keyboard hotkeys for entity actions. Hotkey targets the entity under the cursor.

Initial bindings (defaults, remapping out of scope this pass):

- `F` — Flip
- `Q` — Rotate CCW
- `E` — Rotate CW
- `L` — Lock toggle

## Action layer (refactor — replaces `onContextMenu` / `onAction` split)

Components implement:

```ts
getActions(ctx: ActionContext): ActionDefinition[];
onAction(name: string, ctx: ActionContext): void;
```

```ts
type ActionDefinition = {
  name:     string;            // canonical id, e.g. "flip"
  label:    string;            // user-facing
  icon?:    string;
  enabled?: boolean;
};

type ActionContext = {
  entity:        Entity;
  recipientSeat: SeatIndex | null;
  isHost:        boolean;
  preferences:   Preferences;  // snapshot at dispatch time
};
```

- Pure, static actions. No per-call args.
- Components self-gate (e.g., `MeshComponent` omits `rotate-*` when `dice` present).
- Same `ActionContext` shape passed to both `getActions` and `onAction`.

### Canonical action names

- `flip`
- `rotate-cw`
- `rotate-ccw`
- `lock-toggle`
- `roll`

Renames:

- `DiceComponent`: `rotate` → `rotate-cw`.
- `PhysicsComponent`: `lock` / `unlock` → single `lock-toggle`. Label dynamic on `state.isLocked` ("Lock" vs "Unlock"). Handler toggles state.

### Conflict rule

Self-gating only. If two components claim the same action name on one entity, the first iterated wins. Today's pattern (`MeshComponent` checks `has('dice')`) continues.

## Menu controls (separate track)

Colorpicker (`set-tint`) and future user-input menu items live **outside** `getActions()`. New hook on components (e.g. `getMenuControls()`) returns the existing `MenuItem` shapes with `args` flowing from user input. Not hotkey-able.

Context menu is rendered as `[...getActions().map(toMenuItem), ...getMenuControls()]`.

## Dispatch

Rename `dispatchMenuAction` → `dispatchAction`:

```ts
dispatchAction(entityId, componentTypeId, actionName, deps): void
```

- No `args` parameter on the action path.
- Dispatcher snapshots `loadPreferences()` into `ctx.preferences`. Removes inline `loadPreferences()` reads from components.
- `canManipulate` ownership gate stays — applies to hotkeys.
- Host: local invoke (`comp.onAction(name, ctx)`).
- Guest: existing `invoke-action` RPC; drop `args` field from the wire schema.

Menu-control path keeps `args` (colorpicker still ships `{ value }`).

## Hotkey dispatcher (new)

`HotkeyDispatcher` in `packages/client/src/input/`, parallels `ContextMenuController`.

- Constructed in `ThreeCanvas.tsx` alongside the other input controllers.
- Listener on the **canvas element**, not `window`. Text inputs / sidebars naturally don't trigger.
- Reads `InputDispatcher.hoveredId` directly (shared ref / constructor injection).
- Builds an inverse map (`key → actionName`) from `Preferences.hotkeys` at load time.

On `keydown`:

1. If `e.repeat` → return.
2. If `e.shiftKey || e.ctrlKey || e.altKey || e.metaKey` → return.
3. If context menu is open → return.
4. If no hovered entity → return.
5. Look up `actionName` from `e.key.toLowerCase()`.
6. Walk hovered entity's components, call `getActions(ctx)` on each, find first def with `name === actionName` and `enabled !== false`.
7. Call `dispatchAction(entityId, componentTypeId, actionName, deps)`.

## Preferences

Add to `Preferences`:

```ts
hotkeys: Record<ActionName, string>;
```

Default:

```ts
{
  flip:           'f',
  'rotate-cw':    'e',
  'rotate-ccw':   'q',
  'lock-toggle':  'l',
}
```

Versioning in `preferences/types.ts` handles the new field with default fallback. No UI edits this pass.

## Out of scope

- Remapping UI in the gear modal.
- Showing key hint in context menu labels (e.g. "Flip (F)").
- Visual feedback when a hotkey fires.
- Modifier-key combos, chords.
