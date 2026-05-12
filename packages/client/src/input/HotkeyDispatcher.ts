// HotkeyDispatcher — issue #3 of issues--hotkeys.md.
//
// Listens for canvas keydown events, resolves the binding from
// `Preferences.hotkeys`, and dispatches the matching action against the
// currently-hovered entity via `dispatchAction`. End-to-end: hover a card,
// press `F`, it flips.
//
// Filter rules (each short-circuits, in order):
//   1. `e.repeat`        — held keys fire once (User Story 11).
//   2. Modifier keys     — Ctrl / Alt / Meta / Shift falls through to the
//                          browser (US 12).
//   3. Menu open         — hotkeys yield while the context menu is shown
//                          (US 10).
//   4. No hovered entity — stray keypresses do nothing (US 8).
//   5. No binding for `e.key` — no-op.
//   6. Hovered entity exposes no matching action — no-op (US 7: dice + `F`).
//
// On all of (1)–(6), the listener is silent — no `preventDefault`, no
// dispatch — so text inputs and browser shortcuts coexist naturally.
//
// Preference snapshot is taken at dispatch time (matches the context menu's
// behaviour), so changing `rotateAmount` reflects on the next press (US 19).
//
// Conflict resolution: when two components on an entity expose the same
// action name, the first one in component iteration order wins. Today the
// only collision is MeshComponent vs DiceComponent for `rotate-cw` /
// `rotate-ccw`; MeshComponent self-gates on `has('dice')` so DiceComponent
// wins on dice (US 6).

import { type World } from '../entity/world';
import { type Entity } from '../entity/Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { type ChannelMessage } from '../net/SceneState';
import { type ActionContext } from '../entity/EntityComponent';
import { componentRegistry } from '../entity/ComponentRegistry';
import { type Preferences, type HotkeyMap } from '../preferences/types';
import { load as loadPreferences } from '../preferences/storage';
import { dispatchAction } from './ContextMenuController';

// Minimal subset of KeyboardEvent the dispatcher reads — lets unit tests
// fake events without a DOM environment.
export interface KeyEventLike {
  key:      string;
  repeat:   boolean;
  shiftKey: boolean;
  ctrlKey:  boolean;
  altKey:   boolean;
  metaKey:  boolean;
}

export interface HotkeyDispatcherDeps {
  world:           World;
  element:         HTMLElement;
  isHost:          boolean;
  getSelfSeat:     () => SeatIndex | null;
  getHoveredId:    () => string | null;
  // True when the React context menu is shown; the dispatcher skips while
  // the menu owns the input focus (US 10).
  isMenuOpen:      () => boolean;
  send:            (msg: ChannelMessage) => void;
  // Test seams — production defaults are the public `loadPreferences()` and
  // `dispatchAction()`.
  loadPrefs?:      () => Preferences;
  dispatchAction?: typeof dispatchAction;
}

export class HotkeyDispatcher {
  private readonly loadPrefs:      () => Preferences;
  private readonly dispatchAction: typeof dispatchAction;

  constructor(private readonly deps: HotkeyDispatcherDeps) {
    this.loadPrefs      = deps.loadPrefs      ?? (() => loadPreferences());
    this.dispatchAction = deps.dispatchAction ?? dispatchAction;
    deps.element.addEventListener('keydown', this.onKeyDown as unknown as EventListener);
  }

  dispose(): void {
    this.deps.element.removeEventListener('keydown', this.onKeyDown as unknown as EventListener);
  }

  private onKeyDown = (e: KeyEventLike): void => {
    if (e.repeat) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (this.deps.isMenuOpen()) return;

    const hoveredId = this.deps.getHoveredId();
    if (!hoveredId) return;

    const prefs      = this.loadPrefs();
    const actionName = resolveActionName(prefs.hotkeys, e.key);
    if (!actionName) return;

    const handle = this.deps.world.get(hoveredId);
    if (!handle) return;
    const entity = handle.entity;

    const ctx: ActionContext = {
      recipientSeat: this.deps.getSelfSeat(),
      isHost:        this.deps.isHost,
      entity,
      preferences:   prefs,
    };
    const componentTypeId = findOwningComponent(entity, actionName, ctx);
    if (!componentTypeId) return;

    this.dispatchAction(entity.id, componentTypeId, actionName, {
      isHost:   this.deps.isHost,
      entity,
      send:     this.deps.send,
      selfSeat: this.deps.getSelfSeat(),
    });
  };
}

// Inverse lookup: `key` (lower-cased) → action name. Returns null when the
// key isn't bound. Built inline per dispatch — the map is small (≤5 entries),
// so no caching needed.
function resolveActionName(hotkeys: HotkeyMap, key: string): string | null {
  const lower = key.toLowerCase();
  for (const [name, binding] of Object.entries(hotkeys)) {
    if (binding === '') continue;
    if (binding === lower) return name;
  }
  return null;
}

// Walks the entity's components in topo-sorted order (same as the context
// menu aggregator) and returns the typeId of the first component whose
// `getActions(ctx)` exposes a matching name that isn't `enabled: false`.
// Matches the context-menu's conflict-resolution behaviour: today only
// MeshComponent vs DiceComponent for rotate matters, and MeshComponent
// self-gates on `has('dice')` so DiceComponent wins on dice.
function findOwningComponent(entity: Entity, actionName: string, ctx: ActionContext): string | null {
  const typeIds = [...entity.components.keys()];
  const order   = componentRegistry.getSpawnOrder(typeIds);
  for (const cls of order) {
    const comp = entity.components.get(cls.typeId);
    if (!comp) continue;
    const defs = comp.getActions(ctx);
    for (const def of defs) {
      if (def.name !== actionName) continue;
      if (def.enabled === false)    continue;
      return cls.typeId;
    }
  }
  return null;
}
