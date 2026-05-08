// InputDispatcher unit tests — issues #1 and #2 of issues--interaction.md.
//
// Drives the dispatcher with synthetic `PointerEventLike` objects and a
// scripted picker so the tests exercise pressed / released / click / hover
// semantics without a DOM environment, mirroring `ToolDispatcher.test.ts`.
// The picker seam is the test-only override on `InputDispatcherDeps`;
// production wires up the real raycaster against `MeshComponent.group`. The
// fake picker returns a list (near→far) — eligibility and carry suppression
// are applied inside the dispatcher.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { InputDispatcher, type EntityPicker, type InputPickResult } from './InputDispatcher';
import { Entity } from '../entity/Entity';
import { TableComponent } from '../entity/components/TableComponent';
import { type World } from '../entity/world';

interface FakeHandle {
  id:     string;
  entity: Entity;
}

class FakeElement {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  rectX = 0; rectY = 0; rectW = 100; rectH = 100;

  addEventListener(type: string, fn: (e: unknown) => void): void {
    let bucket = this.listeners.get(type);
    if (!bucket) { bucket = new Set(); this.listeners.set(type, bucket); }
    bucket.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string, evt: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(evt);
  }

  getBoundingClientRect() {
    return {
      x: this.rectX, y: this.rectY,
      left: this.rectX, top: this.rectY,
      right: this.rectX + this.rectW, bottom: this.rectY + this.rectH,
      width: this.rectW, height: this.rectH,
    };
  }
}

function makeEntity(id: string): Entity {
  return new Entity({ id, type: 'token', name: id });
}

function pointerEvent(opts: Partial<{
  pointerId: number; button: number;
  clientX:   number; clientY: number;
  shiftKey:  boolean; ctrlKey: boolean; altKey: boolean;
}> = {}) {
  return {
    pointerId: opts.pointerId ?? 1,
    button:    opts.button    ?? 0,
    clientX:   opts.clientX   ?? 50,
    clientY:   opts.clientY   ?? 50,
    shiftKey:  opts.shiftKey  ?? false,
    ctrlKey:   opts.ctrlKey   ?? false,
    altKey:    opts.altKey    ?? false,
  };
}

let element:    FakeElement;
let camera:     THREE.PerspectiveCamera;
let handles:    Map<string, FakeHandle>;
let world:      World;
let dispatcher: InputDispatcher;
let now:        number;
// Picker scripted per-test: returns the entity ids under (cx, cy) near→far.
// Empty array means "no hit".
let pickFor:    (clientX: number, clientY: number) => string[];

const HIT_POINT = { x: 1, y: 2, z: 3 };

beforeEach(() => {
  element  = new FakeElement();
  camera   = new THREE.PerspectiveCamera();
  handles  = new Map();
  now      = 0;
  pickFor  = () => [];

  world = {
    forEach(fn: (h: FakeHandle) => void) {
      for (const h of handles.values()) fn(h);
    },
    get(id: string) {
      return handles.get(id);
    },
    // Issue #4 routes dispatch through the World; the dual-fire seam lives
    // there. Test fake fires locally only — RPC behaviour is exercised in
    // World.test.ts via the in-memory transport pair.
    fireInputEvent(entity: Entity, eventName: string, payload: unknown) {
      entity.dispatchEvent(eventName, payload);
    },
  } as unknown as World;

  const picker: EntityPicker = (cx, cy): InputPickResult[] => {
    return pickFor(cx, cy)
      .map((id) => handles.get(id))
      .filter((h): h is FakeHandle => !!h)
      .map((h) => ({ entity: h.entity, worldHit: { ...HIT_POINT } }));
  };

  dispatcher = new InputDispatcher({
    world, camera,
    element: element as unknown as HTMLElement,
    getSelfSeat: () => 0,
    pickAt:      picker,
    now:         () => now,
  });
});

afterEach(() => {
  dispatcher.dispose();
});

function addEntity(id: string): Entity {
  const e = makeEntity(id);
  handles.set(id, { id, entity: e });
  return e;
}

function recordEvents(entity: Entity): { events: { name: string; payload: unknown }[] } {
  const events: { name: string; payload: unknown }[] = [];
  for (const name of ['pressed', 'released', 'click', 'hover-start', 'hover-end']) {
    entity.addEventListener(name, (payload) => events.push({ name, payload }));
  }
  return { events };
}

describe('InputDispatcher — press / release / click', () => {
  test('press → release within 150ms / 5px → fires pressed, released, click', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    now = 0;
    element.dispatch('pointerdown', pointerEvent({ clientX: 50, clientY: 50 }));
    now = 100;
    element.dispatch('pointerup',   pointerEvent({ clientX: 50, clientY: 50 }));

    expect(events.map(ev => ev.name)).toEqual(['pressed', 'released', 'click']);
  });

  test('press → release after 150ms → fires pressed and released only', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    now = 0;
    element.dispatch('pointerdown', pointerEvent({ clientX: 50, clientY: 50 }));
    now = 200;
    element.dispatch('pointerup',   pointerEvent({ clientX: 50, clientY: 50 }));

    expect(events.map(ev => ev.name)).toEqual(['pressed', 'released']);
  });

  test('press → release after move > 5px → fires pressed and released only', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    now = 0;
    element.dispatch('pointerdown', pointerEvent({ clientX: 50, clientY: 50 }));
    now = 50;
    element.dispatch('pointermove', pointerEvent({ clientX: 60, clientY: 60 }));
    element.dispatch('pointerup',   pointerEvent({ clientX: 60, clientY: 60 }));

    expect(events.map(ev => ev.name)).toEqual(['pressed', 'released']);
  });

  test('press on A → cursor moves to B → release fires released on A only', () => {
    const a = addEntity('a');
    const b = addEntity('b');
    const aRec = recordEvents(a);
    const bRec = recordEvents(b);

    pickFor = (cx) => (cx < 50 ? ['a'] : ['b']);

    now = 0;
    element.dispatch('pointerdown', pointerEvent({ clientX: 25, clientY: 50 }));
    now = 50;
    element.dispatch('pointerup',   pointerEvent({ clientX: 75, clientY: 50 }));

    expect(aRec.events.map(ev => ev.name)).toEqual(['pressed', 'released']);
    expect(bRec.events).toEqual([]);
  });

  test('despawn while press-captured → no released, no click', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    now = 0;
    element.dispatch('pointerdown', pointerEvent());

    handles.delete('a');
    pickFor = () => [];

    now = 50;
    element.dispatch('pointerup', pointerEvent());

    expect(events.map(ev => ev.name)).toEqual(['pressed']);
  });

  test('right-click pointerdown / pointerup emit nothing', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    element.dispatch('pointerdown', pointerEvent({ button: 2 }));
    element.dispatch('pointerup',   pointerEvent({ button: 2 }));

    expect(events).toEqual([]);
  });

  test('middle-click pointerdown / pointerup emit nothing', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    element.dispatch('pointerdown', pointerEvent({ button: 1 }));
    element.dispatch('pointerup',   pointerEvent({ button: 1 }));

    expect(events).toEqual([]);
  });

  test('pointerdown over empty space → no events, no capture', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => [];

    element.dispatch('pointerdown', pointerEvent());
    pickFor = () => ['a'];
    element.dispatch('pointerup',   pointerEvent());

    expect(events).toEqual([]);
  });

  test('press on ineligible entity (Table) → no events', () => {
    const e = addEntity('table');
    e.attachComponent(new TableComponent());
    const { events } = recordEvents(e);
    pickFor = () => ['table'];

    element.dispatch('pointerdown', pointerEvent());
    element.dispatch('pointerup',   pointerEvent());
    expect(events).toEqual([]);
  });
});

describe('InputDispatcher — payload', () => {
  test('payload carries seat, modifier keys, and worldHit', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    now = 0;
    element.dispatch('pointerdown', pointerEvent({ shiftKey: true, ctrlKey: true, altKey: true }));
    now = 50;
    element.dispatch('pointerup', pointerEvent({ shiftKey: true, ctrlKey: true, altKey: true }));

    expect(events).toHaveLength(3);
    for (const ev of events) {
      expect(ev.payload).toMatchObject({
        seat:     0,
        shiftKey: true,
        ctrlKey:  true,
        altKey:   true,
        worldHit: HIT_POINT,
      });
    }
  });

  test('released payload omits worldHit when cursor is off captured entity', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);

    pickFor = (cx) => (cx < 50 ? ['a'] : []);
    now = 0;
    element.dispatch('pointerdown', pointerEvent({ clientX: 25, clientY: 50 }));
    now = 50;
    element.dispatch('pointerup',   pointerEvent({ clientX: 75, clientY: 50 }));

    const released = events.find(ev => ev.name === 'released');
    expect(released).toBeDefined();
    expect((released!.payload as { worldHit?: unknown }).worldHit).toBeUndefined();
  });
});

describe('InputDispatcher — hover-start / hover-end', () => {
  test('cursor moves over entity → hover-start; moves off → hover-end', () => {
    const a = addEntity('a');
    const aRec = recordEvents(a);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    dispatcher.update(0.016);
    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start']);

    pickFor = () => [];
    element.dispatch('pointermove', pointerEvent({ clientX: 90, clientY: 50 }));
    dispatcher.update(0.016);
    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start', 'hover-end']);
  });

  test('cursor moves from A onto B → hover-end on A, hover-start on B', () => {
    const a = addEntity('a');
    const b = addEntity('b');
    const aRec = recordEvents(a);
    const bRec = recordEvents(b);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ clientX: 25, clientY: 50 }));
    dispatcher.update(0.016);

    pickFor = () => ['b'];
    element.dispatch('pointermove', pointerEvent({ clientX: 75, clientY: 50 }));
    dispatcher.update(0.016);

    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start', 'hover-end']);
    expect(bRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('entity moves under stationary cursor → hover-end on old, hover-start on new', () => {
    const a = addEntity('a');
    const b = addEntity('b');
    const aRec = recordEvents(a);
    const bRec = recordEvents(b);

    // Cursor doesn't move, but the topmost entity changes between frames.
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    pickFor = () => ['a'];
    dispatcher.update(0.016);
    pickFor = () => ['b'];
    dispatcher.update(0.016);

    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start', 'hover-end']);
    expect(bRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('carrying entity A → hover-start fires on B (below A), not A', () => {
    const a = addEntity('a');
    const b = addEntity('b');
    const aRec = recordEvents(a);
    const bRec = recordEvents(b);

    a.heldBy = 0;  // viewer seat carries A

    // Picker reports A near, B far — same cursor position.
    pickFor = () => ['a', 'b'];
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    dispatcher.update(0.016);

    expect(aRec.events).toEqual([]);
    expect(bRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('despawn while hovered → no synthetic hover-end', () => {
    const a = addEntity('a');
    const aRec = recordEvents(a);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    dispatcher.update(0.016);
    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start']);

    handles.delete('a');
    pickFor = () => [];
    dispatcher.update(0.016);

    // No hover-end fired despite the cursor no longer hovering anything.
    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('eligibility flips mid-hover (isContained) → hover-end suppressed', () => {
    const a = addEntity('a');
    const aRec = recordEvents(a);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    dispatcher.update(0.016);

    a.isContained = true;
    pickFor = () => [];  // (raycast would also lose A in real code)
    dispatcher.update(0.016);

    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('eligibility flips mid-hover (privateToSeat) → hover-end suppressed', () => {
    const a = addEntity('a');
    const aRec = recordEvents(a);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    dispatcher.update(0.016);

    a.privateToSeat = 1;  // viewer is seat 0 — now ineligible
    dispatcher.update(0.016);

    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('carry started mid-hover → hover-end suppressed', () => {
    const a = addEntity('a');
    const aRec = recordEvents(a);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ clientX: 50, clientY: 50 }));
    dispatcher.update(0.016);

    a.heldBy = 0;  // viewer picks it up — carry-suppression kicks in
    dispatcher.update(0.016);

    expect(aRec.events.map(ev => ev.name)).toEqual(['hover-start']);
  });

  test('hover payload carries seat and last modifier-key state', () => {
    const a = addEntity('a');
    const aRec = recordEvents(a);

    pickFor = () => ['a'];
    element.dispatch('pointermove', pointerEvent({ shiftKey: true }));
    dispatcher.update(0.016);

    const payload = aRec.events[0].payload as Record<string, unknown>;
    expect(payload.seat).toBe(0);
    expect(payload.shiftKey).toBe(true);
    expect(payload.worldHit).toEqual(HIT_POINT);
  });
});

describe('InputDispatcher — dispose', () => {
  test('dispose detaches listeners — subsequent events are ignored', () => {
    const e = addEntity('a');
    const { events } = recordEvents(e);
    pickFor = () => ['a'];

    dispatcher.dispose();
    element.dispatch('pointerdown', pointerEvent());
    element.dispatch('pointerup',   pointerEvent());
    expect(events).toEqual([]);
  });
});
