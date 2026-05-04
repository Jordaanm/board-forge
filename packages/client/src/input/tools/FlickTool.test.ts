// FlickTool unit tests — issues #5a / #5b of issues--tools.md.
//
// Click mode (#5a): release within 150ms + movement ≤5px + entity hit fires
// applyImpulse along camera-forward (vy = 0).
// Aim mode (#5b): hold ≥150ms or movement >5px enters aim mode; release
// fires impulse with pull semantics; magnitude scales linearly with drag,
// capped at FLICK_MAX_MAGNITUDE; Escape cancels without firing.

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FlickTool } from './FlickTool';
import { FlickArrowAttachment } from './FlickArrowAttachment';
import { type ToolContext, type ToolPointerEvent } from './types';
import { type World } from '../../entity/world';
import { FLICK_DEFAULT_MAGNITUDE, FLICK_MAX_MAGNITUDE } from '../../config/flickConfig';

interface ImpulseCall { x: number; y: number; z: number }

class FakeEntityHandle {
  impulses: ImpulseCall[] = [];
  constructor(public id: string, public obj: THREE.Object3D, public mass = 1) {}
  get(cls: { typeId: string }): unknown {
    if (cls?.typeId === 'physics') return { state: { mass: this.mass, isLocked: false } };
    return { object3d: this.obj };
  }
  applyImpulse(v: ImpulseCall) { this.impulses.push(v); }
}

function makeWorld(handles: FakeEntityHandle[]): World {
  return {
    forEach(fn: (h: FakeEntityHandle) => void) { for (const h of handles) fn(h); },
    pickByObject3D(obj: THREE.Object3D): FakeEntityHandle | undefined {
      for (const h of handles) {
        if (obj === h.obj || h.obj === obj.parent) return h;
      }
      return undefined;
    },
  } as unknown as World;
}

function makeCtx(world: World, camera: THREE.PerspectiveCamera, scene: THREE.Scene): ToolContext {
  return {
    world,
    scene,
    camera,
    element:     {} as HTMLElement,
    raycaster:   new THREE.Raycaster(),
    getSelfSeat: () => 0,
  };
}

// Build a pointer event whose ray hits a horizontal world point. Caller can
// override the world point to drive aim-mode drag direction.
function pointerEvent(opts: {
  worldX?:   number;
  worldZ?:   number;
  clientX?:  number;
  clientY?:  number;
  pointerId?: number;
  button?:   number;
  timestamp?: number;
} = {}): ToolPointerEvent {
  const wx = opts.worldX ?? 0;
  const wz = opts.worldZ ?? 0;
  // Place the ray origin straight above (wx, wz) and aim straight down so
  // the ray-plane intersection lands at exactly (wx, 0, wz).
  const origin = new THREE.Vector3(wx, 5, wz);
  const dir    = new THREE.Vector3(0, -1, 0);
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

let tool:       FlickTool;
let attachment: FlickArrowAttachment;
let scene:      THREE.Scene;
let camera:     THREE.PerspectiveCamera;
let world:      World;
let handle:     FakeEntityHandle;
let nowMs:      number;

beforeEach(() => {
  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 5, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  obj.position.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  handle = new FakeEntityHandle('die-1', obj);
  world = makeWorld([handle]);

  attachment = new FlickArrowAttachment(scene);
  tool = new FlickTool(attachment);
  nowMs = 1000;
  (tool as unknown as { now: () => number }).now = () => nowMs;
});

describe('FlickTool — click mode', () => {
  test('release within 150ms fires impulse along camera-forward', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent(), ctx);
    nowMs = 1100;
    tool.onRelease(pointerEvent(), ctx);

    expect(handle.impulses).toHaveLength(1);
    const v = handle.impulses[0];
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    expect(len).toBeCloseTo(FLICK_DEFAULT_MAGNITUDE, 5);
    expect(v.y).toBe(0);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.z).toBeLessThan(0);
  });

  test('press on empty space → no impulse', () => {
    world  = makeWorld([]);
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent(), ctx);
    nowMs = 1100;
    tool.onRelease(pointerEvent(), ctx);
    expect(handle.impulses).toHaveLength(0);
  });
});

describe('FlickTool — aim mode entry', () => {
  test('hold ≥150ms (without moving) enters aim mode; release with no drag → no impulse', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent(), ctx);
    nowMs = 1200;                              // past the 150ms threshold
    tool.update(0.016, ctx);                   // promotes to aim mode
    expect(attachment.isAttached()).toBe(true);
    tool.onRelease(pointerEvent(), ctx);       // released without dragging
    expect(handle.impulses).toHaveLength(0);
    expect(attachment.isAttached()).toBe(false);
  });

  test('movement >5px enters aim mode and attaches the arrow', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent({ clientX: 0, clientY: 0 }), ctx);
    expect(attachment.isAttached()).toBe(false);
    tool.onMove(pointerEvent({ clientX: 0, clientY: 50, worldX: 0, worldZ: 1 }), ctx);
    expect(attachment.isAttached()).toBe(true);
  });
});

describe('FlickTool — aim mode release', () => {
  test('release fires impulse with pull semantics (opposite of drag)', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    // Press at world (0, 0); pointer drags to world (+0.5, +0.3).
    tool.onPress  (pointerEvent({ clientX: 0,  clientY: 0,  worldX: 0,    worldZ: 0   }), ctx);
    tool.onMove   (pointerEvent({ clientX: 0,  clientY: 50, worldX: 0.5,  worldZ: 0.3 }), ctx);  // triggers aim
    tool.onRelease(pointerEvent({ clientX: 0,  clientY: 50, worldX: 0.5,  worldZ: 0.3 }), ctx);

    expect(handle.impulses).toHaveLength(1);
    const v = handle.impulses[0];
    // Pull → impulse in (-0.5, 0, -0.3) direction.
    expect(v.x).toBeLessThan(0);
    expect(v.z).toBeLessThan(0);
    expect(v.y).toBe(0);
  });

  test('magnitude scales with drag distance and caps at FLICK_MAX_MAGNITUDE', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    // Drag world distance = 100 (well past the 1.5 cap with scale 1.0).
    tool.onPress  (pointerEvent({ clientX: 0, clientY: 0,  worldX: 0,   worldZ: 0 }), ctx);
    tool.onMove   (pointerEvent({ clientX: 0, clientY: 50, worldX: 100, worldZ: 0 }), ctx);
    tool.onRelease(pointerEvent({ clientX: 0, clientY: 50, worldX: 100, worldZ: 0 }), ctx);

    expect(handle.impulses).toHaveLength(1);
    const v = handle.impulses[0];
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    expect(len).toBeCloseTo(FLICK_MAX_MAGNITUDE, 5);
  });
});

describe('FlickTool — Escape cancellation', () => {
  test('Escape during aim mode detaches arrow and fires no impulse', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent({ clientX: 0, clientY: 0 }), ctx);
    tool.onMove (pointerEvent({ clientX: 0, clientY: 50, worldX: 0, worldZ: 1 }), ctx);
    expect(attachment.isAttached()).toBe(true);

    tool.onCancel(ctx);
    expect(attachment.isAttached()).toBe(false);
    expect(tool.hasActiveGesture()).toBe(false);

    tool.onRelease(pointerEvent({ worldX: 0, worldZ: 1 }), ctx);
    expect(handle.impulses).toHaveLength(0);
  });

  test('Tool deactivate during aim mode detaches arrow without firing', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent({ clientX: 0, clientY: 0 }), ctx);
    tool.onMove (pointerEvent({ clientX: 0, clientY: 50, worldX: 0, worldZ: 1 }), ctx);

    tool.onDeactivate(ctx);
    expect(attachment.isAttached()).toBe(false);
    expect(handle.impulses).toHaveLength(0);
  });
});

describe('FlickTool — mass scaling', () => {
  test('click impulse scales linearly with target mass (constant Δv)', () => {
    const lightObj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    lightObj.position.set(0, 0, 0);
    lightObj.updateMatrixWorld(true);
    const heavyObj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    heavyObj.position.set(0, 0, 0);
    heavyObj.updateMatrixWorld(true);
    const light = new FakeEntityHandle('light', lightObj, 0.1);
    const heavy = new FakeEntityHandle('heavy', heavyObj, 1.0);

    const fireOn = (h: FakeEntityHandle) => {
      const w  = makeWorld([h]);
      const c  = makeCtx(w, camera, scene);
      const t  = new FlickTool(new FlickArrowAttachment(scene));
      (t as unknown as { now: () => number }).now = () => nowMs;
      nowMs = 1000;
      t.onPress(pointerEvent(), c);
      nowMs = 1100;
      t.onRelease(pointerEvent(), c);
    };

    fireOn(light);
    fireOn(heavy);

    const lightLen = Math.hypot(light.impulses[0].x, light.impulses[0].z);
    const heavyLen = Math.hypot(heavy.impulses[0].x, heavy.impulses[0].z);
    expect(heavyLen / lightLen).toBeCloseTo(10, 5);  // 1.0 / 0.1
  });
});

describe('FlickTool — gesture state', () => {
  test('hasActiveGesture true between press and release', () => {
    const ctx = makeCtx(world, camera, scene);
    expect(tool.hasActiveGesture()).toBe(false);
    tool.onPress(pointerEvent(), ctx);
    expect(tool.hasActiveGesture()).toBe(true);
    tool.onRelease(pointerEvent(), ctx);
    expect(tool.hasActiveGesture()).toBe(false);
  });

  test('hasActiveGesture true while in aim mode (so dispatcher rejects tool switch)', () => {
    const ctx = makeCtx(world, camera, scene);
    nowMs = 1000;
    tool.onPress(pointerEvent({ clientX: 0, clientY: 0 }), ctx);
    tool.onMove (pointerEvent({ clientX: 0, clientY: 50, worldX: 0, worldZ: 1 }), ctx);
    expect(tool.hasActiveGesture()).toBe(true);
  });
});
