// ToolDispatcher unit tests — issue 2a of issues--tools.md.
//
// Drives the dispatcher with synthetic pointer events through a fake tool;
// verifies hook order, the reject-during-active-gesture rule, and Escape
// cancellation. World/scene plumbing is stubbed and an in-memory EventTarget
// stands in for the DOM so the test runs in the project's default Node env.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { ToolDispatcher } from './ToolDispatcher';
import { type Tool, type ToolPointerEvent, type ToolContext } from './types';
import { type World } from '../../entity/world';

interface RecordedCall {
  hook: 'activate' | 'deactivate' | 'press' | 'move' | 'release' | 'cancel' | 'update';
  detail?: unknown;
}

class FakeTool implements Tool {
  readonly id    = 'fake';
  readonly label = 'Fake';
  readonly hotkey = '1';

  calls:    RecordedCall[] = [];
  gesture = false;

  hasActiveGesture(): boolean { return this.gesture; }

  onActivate  (_ctx: ToolContext): void { this.calls.push({ hook: 'activate'   }); }
  onDeactivate(_ctx: ToolContext): void { this.calls.push({ hook: 'deactivate' }); }
  onPress  (e: ToolPointerEvent, _ctx: ToolContext): void {
    this.calls.push({ hook: 'press',   detail: { button: e.button } });
  }
  onMove   (e: ToolPointerEvent, _ctx: ToolContext): void {
    this.calls.push({ hook: 'move',    detail: { button: e.button } });
  }
  onRelease(e: ToolPointerEvent, _ctx: ToolContext): void {
    this.calls.push({ hook: 'release', detail: { button: e.button } });
  }
  onCancel (_ctx: ToolContext): void { this.calls.push({ hook: 'cancel' }); }
  update   (dt: number, _ctx: ToolContext): void { this.calls.push({ hook: 'update', detail: { dt } }); }
}

// Minimal element stub — captures listeners + provides getBoundingClientRect.
// `dispatch(type, evt)` fires every registered handler for the type.
class FakeElement {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  rectX = 0;
  rectY = 0;
  rectW = 100;
  rectH = 100;
  capturedPointers: number[] = [];

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

  setPointerCapture(id: number): void { this.capturedPointers.push(id); }
  releasePointerCapture(_id: number): void {}
}

function pointerEvent(opts: Partial<{
  button:    number; clientX: number; clientY: number; pointerId: number;
  shiftKey:  boolean; ctrlKey: boolean; altKey: boolean;
}> = {}) {
  return {
    pointerId: opts.pointerId ?? 1,
    button:    opts.button    ?? 0,
    clientX:   opts.clientX   ?? 10,
    clientY:   opts.clientY   ?? 10,
    shiftKey:  opts.shiftKey  ?? false,
    ctrlKey:   opts.ctrlKey   ?? false,
    altKey:    opts.altKey    ?? false,
  };
}

let element: FakeElement;
let keyTarget: EventTarget;
let camera:  THREE.PerspectiveCamera;
let scene:   THREE.Scene;
let world:   World;
let dispatcher: ToolDispatcher;

beforeEach(() => {
  element   = new FakeElement();
  keyTarget = new EventTarget();
  camera = new THREE.PerspectiveCamera();
  scene  = new THREE.Scene();
  world  = {} as World;
  dispatcher = new ToolDispatcher({
    world, scene, camera,
    element: element as unknown as HTMLElement,
    getSelfSeat: () => null,
    keyTarget,
  });
});

afterEach(() => {
  dispatcher.dispose();
});

describe('ToolDispatcher — hook routing', () => {
  test('activates a tool on setActiveTool and forwards onActivate', () => {
    const tool = new FakeTool();
    expect(dispatcher.setActiveTool(tool)).toBe(true);
    expect(tool.calls.map(c => c.hook)).toEqual(['activate']);
  });

  test('forwards pointerdown / move / up to active tool in order', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;

    element.dispatch('pointerdown', pointerEvent({ button: 0, clientX: 10, clientY: 10 }));
    element.dispatch('pointermove', pointerEvent({ button: 0, clientX: 20, clientY: 20 }));
    element.dispatch('pointerup',   pointerEvent({ button: 0, clientX: 20, clientY: 20 }));

    expect(tool.calls.map(c => c.hook)).toEqual(['press', 'move', 'release']);
  });

  test('non-left-button pointerdown / pointerup are not forwarded', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;

    element.dispatch('pointerdown', pointerEvent({ button: 2 }));
    element.dispatch('pointerup',   pointerEvent({ button: 2 }));
    expect(tool.calls).toEqual([]);
  });

  test('pointermove forwards regardless of button (hover tracking)', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;

    element.dispatch('pointermove', pointerEvent({ button: 0 }));
    expect(tool.calls.some(c => c.hook === 'move')).toBe(true);
  });

  test('update(dt) forwards to active tool', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;

    dispatcher.update(0.016);
    expect(tool.calls).toEqual([{ hook: 'update', detail: { dt: 0.016 } }]);
  });
});

describe('ToolDispatcher — tool switch with active gesture', () => {
  test('rejects setActiveTool while current tool reports an active gesture', () => {
    const tool1 = new FakeTool();
    const tool2 = new FakeTool();
    dispatcher.setActiveTool(tool1);
    tool1.gesture = true;

    expect(dispatcher.setActiveTool(tool2)).toBe(false);
    expect(dispatcher.getActive()).toBe(tool1);
    expect(tool2.calls).toEqual([]);
  });

  test('allows setActiveTool once gesture clears', () => {
    const tool1 = new FakeTool();
    const tool2 = new FakeTool();
    dispatcher.setActiveTool(tool1);
    tool1.gesture = true;
    dispatcher.setActiveTool(tool2);  // rejected
    tool1.gesture = false;
    expect(dispatcher.setActiveTool(tool2)).toBe(true);
    expect(dispatcher.getActive()).toBe(tool2);
  });

  test('setActiveTool fires onDeactivate on the old tool', () => {
    const tool1 = new FakeTool();
    const tool2 = new FakeTool();
    dispatcher.setActiveTool(tool1);
    tool1.calls.length = 0;
    dispatcher.setActiveTool(tool2);
    expect(tool1.calls.map(c => c.hook)).toEqual(['deactivate']);
  });

  test('setActiveTool to the same tool is a no-op', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;
    expect(dispatcher.setActiveTool(tool)).toBe(true);
    expect(tool.calls).toEqual([]);
  });
});

describe('ToolDispatcher — Escape cancellation', () => {
  test('Escape calls onCancel only while active gesture is in progress', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;

    keyTarget.dispatchEvent(new Event('keydown') as KeyboardEvent);
    // No active gesture and ke key="Escape" missing — emit a real Escape:
    const escape: { key: string } = { key: 'Escape' };
    (keyTarget as EventTarget & { dispatch?: never }).dispatchEvent(
      Object.assign(new Event('keydown'), escape) as unknown as Event,
    );
    expect(tool.calls.map(c => c.hook)).toEqual([]);

    tool.gesture = true;
    (keyTarget as EventTarget).dispatchEvent(
      Object.assign(new Event('keydown'), escape) as unknown as Event,
    );
    expect(tool.calls.map(c => c.hook)).toEqual(['cancel']);
  });

  test('non-Escape keys do not call onCancel', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.gesture = true;
    tool.calls.length = 0;

    (keyTarget as EventTarget).dispatchEvent(
      Object.assign(new Event('keydown'), { key: 'a' }) as unknown as Event,
    );
    expect(tool.calls).toEqual([]);
  });
});

describe('ToolDispatcher — dispose', () => {
  test('dispose deactivates the active tool and detaches listeners', () => {
    const tool = new FakeTool();
    dispatcher.setActiveTool(tool);
    tool.calls.length = 0;

    dispatcher.dispose();
    expect(tool.calls.map(c => c.hook)).toEqual(['deactivate']);

    element.dispatch('pointerdown', pointerEvent({ button: 0 }));
    expect(tool.calls.filter(c => c.hook === 'press')).toHaveLength(0);
  });
});
