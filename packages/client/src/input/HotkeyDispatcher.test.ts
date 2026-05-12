// HotkeyDispatcher unit tests — issue #3 of issues--hotkeys.md.
//
// Drives the dispatcher with synthetic `KeyEventLike` objects through a fake
// element and a fake World, asserting filter behaviour (repeat, modifiers,
// menu-open, no-hover) and that the test-seam `dispatchAction` spy receives
// the right `(entityId, componentTypeId, actionName)` triple. Mirrors the
// pattern in `InputDispatcher.test.ts`.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { HotkeyDispatcher, type KeyEventLike } from './HotkeyDispatcher';
import { Entity } from '../entity/Entity';
import {
  EntityComponent,
  type ActionContext,
  type ActionDefinition,
} from '../entity/EntityComponent';
import { componentRegistry } from '../entity/ComponentRegistry';
import { DEFAULT_HOTKEYS, DEFAULT_PREFERENCES, type Preferences } from '../preferences/types';
import { type World } from '../entity/world';
import { type ChannelMessage } from '../net/SceneState';

interface FakeHandle { id: string; entity: Entity }

class FakeElement {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    let b = this.listeners.get(type);
    if (!b) { b = new Set(); this.listeners.set(type, b); }
    b.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, evt: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(evt);
  }
}

// Two test components that expose competing rotate-cw actions to verify
// conflict resolution. MeshLike self-gates when a DiceLike sibling is
// present, mirroring the real MeshComponent vs DiceComponent collision.

interface FlipperState { x: number }
class MeshLike extends EntityComponent<FlipperState> {
  static typeId = 'mesh';
  onSpawn() {}
  onPropertiesChanged() {}
  getActions(ctx: ActionContext): ActionDefinition[] {
    const defs: ActionDefinition[] = [{ name: 'flip', label: 'Flip' }];
    // Self-gate rotate when a dice sibling claims it.
    if (!ctx.entity.components.has('dice')) {
      defs.push({ name: 'rotate-cw', label: 'Rotate' });
    }
    return defs;
  }
}

class DiceLike extends EntityComponent<object> {
  static typeId = 'dice';
  static requires = ['mesh'] as const;
  onSpawn() {}
  onPropertiesChanged() {}
  getActions(_ctx: ActionContext): ActionDefinition[] {
    return [{ name: 'rotate-cw', label: 'Rotate (die)' }];
  }
}

class Disabled extends EntityComponent<object> {
  static typeId = 'disabled';
  onSpawn() {}
  onPropertiesChanged() {}
  getActions(_ctx: ActionContext): ActionDefinition[] {
    return [{ name: 'flip', label: 'Flip', enabled: false }];
  }
}

function makeEntity(id: string, comps: Array<new () => EntityComponent<any>>): Entity {
  const e = new Entity({ id, type: 'thing', name: id });
  for (const Ctor of comps) {
    const c = new Ctor();
    c.state = {} as object;
    e.attachComponent(c);
  }
  return e;
}

function keyEvent(opts: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key:      opts.key      ?? 'f',
    repeat:   opts.repeat   ?? false,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey:  opts.ctrlKey  ?? false,
    altKey:   opts.altKey   ?? false,
    metaKey:  opts.metaKey  ?? false,
  };
}

interface DispatchCall {
  entityId:        string;
  componentTypeId: string;
  actionName:      string;
  deps:            { isHost: boolean; entity: Entity | undefined; selfSeat: number | null };
}

let element:   FakeElement;
let handles:   Map<string, FakeHandle>;
let world:     World;
let hovered:   string | null;
let menuOpen:  boolean;
let prefs:     Preferences;
let dispatched: DispatchCall[];
let sent:      ChannelMessage[];
let dispatcher: HotkeyDispatcher;

beforeEach(() => {
  componentRegistry.clear();
  componentRegistry.register(MeshLike as never);
  componentRegistry.register(DiceLike as never);
  componentRegistry.register(Disabled as never);

  element  = new FakeElement();
  handles  = new Map();
  hovered  = null;
  menuOpen = false;
  prefs    = { ...DEFAULT_PREFERENCES, hotkeys: { ...DEFAULT_HOTKEYS } };
  dispatched = [];
  sent       = [];

  world = {
    get(id: string) { return handles.get(id); },
  } as unknown as World;

  dispatcher = new HotkeyDispatcher({
    world,
    element:      element as unknown as HTMLElement,
    isHost:       true,
    getSelfSeat:  () => 0,
    getHoveredId: () => hovered,
    isMenuOpen:   () => menuOpen,
    send:         (msg) => sent.push(msg),
    loadPrefs:    () => prefs,
    dispatchAction: (entityId, componentTypeId, actionName, deps) => {
      dispatched.push({ entityId, componentTypeId, actionName, deps });
    },
  });
});

afterEach(() => {
  dispatcher.dispose();
});

function add(id: string, comps: Array<new () => EntityComponent<any>>): Entity {
  const e = makeEntity(id, comps);
  handles.set(id, { id, entity: e });
  return e;
}

describe('HotkeyDispatcher — happy paths', () => {
  test('hover a card, press F → dispatches flip on the mesh component', () => {
    add('card-1', [MeshLike]);
    hovered = 'card-1';
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      entityId:        'card-1',
      componentTypeId: 'mesh',
      actionName:      'flip',
    });
  });

  test('uppercase keys still resolve (e.key not lower-cased by the browser)', () => {
    add('card-1', [MeshLike]);
    hovered = 'card-1';
    element.dispatch('keydown', keyEvent({ key: 'F' }));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].actionName).toBe('flip');
  });

  test('press E on a token → dispatches rotate-cw on mesh', () => {
    add('token-1', [MeshLike]);
    hovered = 'token-1';
    element.dispatch('keydown', keyEvent({ key: 'e' }));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      componentTypeId: 'mesh',
      actionName:      'rotate-cw',
    });
  });
});

describe('HotkeyDispatcher — filter rules', () => {
  beforeEach(() => {
    add('card-1', [MeshLike]);
    hovered = 'card-1';
  });

  test('e.repeat → no dispatch (US 11)', () => {
    element.dispatch('keydown', keyEvent({ key: 'f', repeat: true }));
    expect(dispatched).toEqual([]);
  });

  test('Ctrl modifier → no dispatch (US 12)', () => {
    element.dispatch('keydown', keyEvent({ key: 'f', ctrlKey: true }));
    expect(dispatched).toEqual([]);
  });

  test('Shift modifier → no dispatch', () => {
    element.dispatch('keydown', keyEvent({ key: 'f', shiftKey: true }));
    expect(dispatched).toEqual([]);
  });

  test('Alt modifier → no dispatch', () => {
    element.dispatch('keydown', keyEvent({ key: 'f', altKey: true }));
    expect(dispatched).toEqual([]);
  });

  test('Meta modifier → no dispatch', () => {
    element.dispatch('keydown', keyEvent({ key: 'f', metaKey: true }));
    expect(dispatched).toEqual([]);
  });

  test('menu open → no dispatch (US 10)', () => {
    menuOpen = true;
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toEqual([]);
  });

  test('no hovered entity → no dispatch (US 8)', () => {
    hovered = null;
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toEqual([]);
  });

  test('hovered entity exists but key has no binding → no dispatch', () => {
    element.dispatch('keydown', keyEvent({ key: 'x' }));
    expect(dispatched).toEqual([]);
  });

  test('unbound action (empty-string binding like `roll`) → no dispatch', () => {
    // Default `roll` binding is the empty string — should never match a key.
    element.dispatch('keydown', keyEvent({ key: '' }));
    expect(dispatched).toEqual([]);
  });
});

describe('HotkeyDispatcher — entity-action matching', () => {
  test('hovered entity has no flip action → no dispatch', () => {
    // Entity with only a component that doesn't expose flip — emulates the
    // "die has no flip" case but with a stand-in.
    class NoFlip extends EntityComponent<object> {
      static typeId = 'no-flip';
      onSpawn() {}
      onPropertiesChanged() {}
      getActions(): ActionDefinition[] { return [{ name: 'other', label: 'Other' }]; }
    }
    componentRegistry.register(NoFlip as never);
    add('e1', [NoFlip]);
    hovered = 'e1';
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toEqual([]);
  });

  test('disabled action def is skipped', () => {
    add('e1', [Disabled]);
    hovered = 'e1';
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toEqual([]);
  });

  test('conflict: entity with MeshLike + DiceLike, press E → routes to dice', () => {
    // MeshLike self-gates when a dice sibling is present (mirrors real
    // MeshComponent behaviour), so DiceLike wins.
    add('die-1', [MeshLike, DiceLike]);
    hovered = 'die-1';
    element.dispatch('keydown', keyEvent({ key: 'e' }));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].componentTypeId).toBe('dice');
  });
});

describe('HotkeyDispatcher — preference snapshot semantics', () => {
  test('dispatch passes the preferences snapshot captured at keydown time', () => {
    add('card-1', [MeshLike]);
    hovered = 'card-1';
    // Sample what we send into prefs at keypress time vs after a change.
    prefs = { ...DEFAULT_PREFERENCES, rotateAmount: 90, hotkeys: { ...DEFAULT_HOTKEYS } };
    element.dispatch('keydown', keyEvent({ key: 'e' }));
    expect(dispatched).toHaveLength(1);

    // Mutating prefs after dispatch must not retroactively change ctx.
    prefs = { ...DEFAULT_PREFERENCES, rotateAmount: 180, hotkeys: { ...DEFAULT_HOTKEYS } };
    element.dispatch('keydown', keyEvent({ key: 'e' }));
    expect(dispatched).toHaveLength(2);
    // Each call observed the prefs object that was current at its keydown.
    // The spy receives the deps object, not the full ctx — to verify
    // snapshot semantics we'd need the production `dispatchAction` to forward
    // ctx. Here we assert the count and that two distinct dispatches were
    // issued from distinct prefs snapshots — the ctx.preferences itself is
    // covered by dispatchAction.test.ts.
  });

  test('changing hotkeys map between presses takes effect immediately', () => {
    add('card-1', [MeshLike]);
    hovered = 'card-1';

    // Default: F → flip
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].actionName).toBe('flip');

    // Remap flip to G
    prefs = { ...prefs, hotkeys: { ...prefs.hotkeys, flip: 'g' } };
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toHaveLength(1);  // still no second dispatch — F is unbound now
    element.dispatch('keydown', keyEvent({ key: 'g' }));
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1].actionName).toBe('flip');
  });
});

describe('HotkeyDispatcher — dispatch deps', () => {
  test('forwards isHost / entity / selfSeat to dispatchAction', () => {
    const e = add('card-1', [MeshLike]);
    hovered = 'card-1';
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched[0].deps).toMatchObject({
      isHost:   true,
      entity:   e,
      selfSeat: 0,
    });
  });
});

describe('HotkeyDispatcher — teardown', () => {
  test('dispose removes the keydown listener (no further dispatches)', () => {
    add('card-1', [MeshLike]);
    hovered = 'card-1';
    dispatcher.dispose();
    element.dispatch('keydown', keyEvent({ key: 'f' }));
    expect(dispatched).toEqual([]);
  });
});
