// PingTool unit tests — issue #4 of issues--tools.md.
//
// Drives PingTool's onPress / onMove / onRelease with a stubbed ToolContext.
// Exercises:
//   * the 500ms sender-side rate limiter (drop second within window; allow
//     after the window).
//   * entity-anchored vs point-anchored payload selection.
//   * movement threshold suppresses ping firing.

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { PingTool } from './PingTool';
import { type ToolContext, type ToolPointerEvent } from './types';
import { type World } from '../../entity/world';

interface BroadcastCall { toolId: string; payload: unknown }

class FakeEntityHandle {
  constructor(public id: string, public obj: THREE.Object3D, public position: [number, number, number]) {}
  get(_cls: unknown): unknown {
    return {
      object3d: this.obj,
      state: { position: this.position },
    };
  }
}

function makeWorld(handles: FakeEntityHandle[]): World {
  const broadcasts: BroadcastCall[] = [];
  const world = {
    forEach(fn: (h: FakeEntityHandle) => void) { for (const h of handles) fn(h); },
    pickByObject3D(obj: THREE.Object3D): FakeEntityHandle | undefined {
      for (const h of handles) {
        if (obj === h.obj || h.obj === obj.parent) return h;
      }
      return undefined;
    },
    get(id: string): FakeEntityHandle | undefined {
      return handles.find(h => h.id === id);
    },
    getTableBounds() { return { halfWidth: 6, halfDepth: 4 }; },
    broadcastToolMessage(toolId: string, payload: unknown) {
      broadcasts.push({ toolId, payload });
    },
    onToolBroadcast() { return () => {}; },
  } as unknown as World;
  (world as unknown as { __broadcasts: BroadcastCall[] }).__broadcasts = broadcasts;
  return world;
}

function makeCtx(world: World): ToolContext {
  return {
    world,
    scene:       new THREE.Scene(),
    camera:      new THREE.PerspectiveCamera(),
    element:     {} as HTMLElement,
    raycaster:   new THREE.Raycaster(),
    getSelfSeat: () => 0,
  };
}

function pointerEvent(opts: Partial<ToolPointerEvent> & {
  rayOrigin?:    THREE.Vector3;
  rayDirection?: THREE.Vector3;
}): ToolPointerEvent {
  const origin = opts.rayOrigin    ?? new THREE.Vector3(0, 5, 0);
  const dir    = opts.rayDirection ?? new THREE.Vector3(0, -1, 0).normalize();
  return {
    pointerId: opts.pointerId ?? 1,
    button:    opts.button    ?? 0,
    clientX:   opts.clientX   ?? 0,
    clientY:   opts.clientY   ?? 0,
    ndc:       new THREE.Vector2(),
    ray:       new THREE.Ray(origin, dir),
    timestamp: opts.timestamp ?? 0,
    shiftKey:  false, ctrlKey: false, altKey: false,
  };
}

let tool: PingTool;
let world: World;
let broadcasts: BroadcastCall[];
let nowMs: number;

beforeEach(() => {
  // No entities by default — point-anchored ping cases supply an empty world.
  world = makeWorld([]);
  broadcasts = (world as unknown as { __broadcasts: BroadcastCall[] }).__broadcasts;
  tool = new PingTool();
  nowMs = 1000;
  (tool as unknown as { now: () => number }).now = () => nowMs;
});

describe('PingTool — rate limiter', () => {
  test('drops second of two pings within 500ms', () => {
    const ctx = makeCtx(world);

    nowMs = 1000;
    tool.onPress(pointerEvent({ timestamp: nowMs }), ctx);
    tool.onRelease(pointerEvent({ timestamp: nowMs }), ctx);
    expect(broadcasts).toHaveLength(1);

    nowMs = 1100;
    tool.onPress(pointerEvent({ timestamp: nowMs }), ctx);
    tool.onRelease(pointerEvent({ timestamp: nowMs }), ctx);
    expect(broadcasts).toHaveLength(1);
  });

  test('allows ping after the 500ms window passes', () => {
    const ctx = makeCtx(world);

    nowMs = 1000;
    tool.onPress(pointerEvent({ timestamp: nowMs }), ctx);
    tool.onRelease(pointerEvent({ timestamp: nowMs }), ctx);
    expect(broadcasts).toHaveLength(1);

    nowMs = 1500;
    tool.onPress(pointerEvent({ timestamp: nowMs }), ctx);
    tool.onRelease(pointerEvent({ timestamp: nowMs }), ctx);
    expect(broadcasts).toHaveLength(2);
  });
});

describe('PingTool — payload resolution', () => {
  test('hits empty table → broadcasts point payload', () => {
    const ctx = makeCtx(world);
    tool.onPress(pointerEvent({}), ctx);
    tool.onRelease(pointerEvent({}), ctx);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].toolId).toBe('ping');
    const payload = broadcasts[0].payload as { point: [number, number] };
    expect(Array.isArray(payload.point)).toBe(true);
    // Default ray hits y=0 plane at (0, 0, 0).
    expect(payload.point[0]).toBeCloseTo(0, 5);
    expect(payload.point[1]).toBeCloseTo(0, 5);
  });

  test('hits an entity → broadcasts entityId payload', () => {
    const obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const handle = new FakeEntityHandle('die-1', obj, [0, 0, 0]);
    world = makeWorld([handle]);
    broadcasts = (world as unknown as { __broadcasts: BroadcastCall[] }).__broadcasts;
    const ctx = makeCtx(world);

    // Ray straight down from above the entity.
    tool.onPress(pointerEvent({}), ctx);
    tool.onRelease(pointerEvent({}), ctx);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].payload).toEqual({ entityId: 'die-1' });
  });

  test('off-table click → no broadcast', () => {
    const ctx = makeCtx(world);
    // Ray pointing straight up (y = +1) — never hits the y=0 plane in front.
    const ray = pointerEvent({
      rayOrigin:    new THREE.Vector3(100, 5, 100),
      rayDirection: new THREE.Vector3(0, 1, 0),
    });
    tool.onPress(ray, ctx);
    tool.onRelease(ray, ctx);
    expect(broadcasts).toHaveLength(0);
  });
});

describe('PingTool — gesture state', () => {
  test('hasActiveGesture true between press and release', () => {
    const ctx = makeCtx(world);
    expect(tool.hasActiveGesture()).toBe(false);
    tool.onPress(pointerEvent({}), ctx);
    expect(tool.hasActiveGesture()).toBe(true);
    tool.onRelease(pointerEvent({}), ctx);
    expect(tool.hasActiveGesture()).toBe(false);
  });

  test('movement past threshold suppresses the broadcast on release', () => {
    const ctx = makeCtx(world);
    tool.onPress(pointerEvent({ clientX: 0, clientY: 0 }), ctx);
    tool.onMove (pointerEvent({ clientX: 50, clientY: 50 }), ctx);
    tool.onRelease(pointerEvent({ clientX: 50, clientY: 50 }), ctx);
    expect(broadcasts).toHaveLength(0);
  });

  test('Escape during pending press cancels without firing', () => {
    const ctx = makeCtx(world);
    tool.onPress(pointerEvent({}), ctx);
    expect(tool.hasActiveGesture()).toBe(true);
    tool.onCancel(ctx);
    expect(tool.hasActiveGesture()).toBe(false);
    tool.onRelease(pointerEvent({}), ctx);
    expect(broadcasts).toHaveLength(0);
  });
});
