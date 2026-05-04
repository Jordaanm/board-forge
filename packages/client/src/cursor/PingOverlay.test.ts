// PingOverlay unit tests — issue #4 of issues--tools.md.
//
// Inbound tool-broadcast → mesh added to the overlay group; lifetime expiry
// disposes the mesh. Entity-anchored pings follow the entity's transform.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PingOverlay } from './PingOverlay';
import { type ToolBroadcast } from '../entity/wire';
import { type World } from '../entity/world';

class FakeEntityHandle {
  constructor(public id: string, public position: [number, number, number]) {}
  get(_cls: unknown): unknown {
    return { state: { position: this.position } };
  }
}

function makeWorld(handles: Map<string, FakeEntityHandle>): World {
  return {
    get(id: string) { return handles.get(id); },
  } as unknown as World;
}

function pingMsg(payload: unknown, opts: Partial<ToolBroadcast> = {}): ToolBroadcast {
  return {
    type:    'tool-broadcast',
    toolId:  opts.toolId ?? 'ping',
    peerId:  opts.peerId ?? 'p1',
    seat:    opts.seat   ?? 0,
    payload,
  };
}

let scene: THREE.Scene;
let handles: Map<string, FakeEntityHandle>;
let world: World;
let overlay: PingOverlay;
let nowMs: number;

beforeEach(() => {
  scene = new THREE.Scene();
  handles = new Map();
  world = makeWorld(handles);
  overlay = new PingOverlay(scene, world);
  nowMs = 1000;
  (overlay as unknown as { now: () => number }).now = () => nowMs;
});

afterEach(() => {
  overlay.dispose();
});

describe('PingOverlay — lifecycle', () => {
  test('ingest creates a mesh; expiry disposes it', () => {
    overlay.ingest(pingMsg({ point: [1, 2] }));
    expect(overlay.pingCount()).toBe(1);
    expect(overlay.group.children.length).toBe(1);

    // Advance past the 1.5s lifetime and tick.
    nowMs = 1000 + 1600;
    overlay.update(1.6);
    expect(overlay.pingCount()).toBe(0);
    expect(overlay.group.children.length).toBe(0);
  });

  test('non-ping tool-broadcast is ignored', () => {
    overlay.ingest(pingMsg({ entityId: 'x' }, { toolId: 'flick' }));
    expect(overlay.pingCount()).toBe(0);
  });

  test('payload missing fields → no ping', () => {
    overlay.ingest(pingMsg({}));
    expect(overlay.pingCount()).toBe(0);
  });

  test('point payload puts the ping at the supplied (x, z)', () => {
    overlay.ingest(pingMsg({ point: [3, -2] }));
    overlay.update(0.016);
    const group = overlay.group.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(3, 5);
    expect(group.position.z).toBeCloseTo(-2, 5);
  });

  test('entity-anchored ping follows the entity', () => {
    handles.set('die-1', new FakeEntityHandle('die-1', [1, 0, 1]));
    overlay.ingest(pingMsg({ entityId: 'die-1' }));
    overlay.update(0.016);

    let group = overlay.group.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(1, 5);
    expect(group.position.z).toBeCloseTo(1, 5);

    // Move the entity; ping should follow on next tick.
    handles.set('die-1', new FakeEntityHandle('die-1', [4, 0, -3]));
    overlay.update(0.016);
    group = overlay.group.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(4, 5);
    expect(group.position.z).toBeCloseTo(-3, 5);
  });

  test('entity-anchored ping ends early if entity despawns mid-lifetime', () => {
    handles.set('die-1', new FakeEntityHandle('die-1', [0, 0, 0]));
    overlay.ingest(pingMsg({ entityId: 'die-1' }));
    expect(overlay.pingCount()).toBe(1);

    handles.delete('die-1');
    overlay.update(0.016);
    expect(overlay.pingCount()).toBe(0);
  });
});

describe('PingOverlay — dispose', () => {
  test('dispose removes the group from the scene and clears all pings', () => {
    overlay.ingest(pingMsg({ point: [0, 0] }));
    overlay.ingest(pingMsg({ point: [1, 1] }));
    expect(overlay.pingCount()).toBe(2);
    expect(scene.children).toContain(overlay.group);

    overlay.dispose();
    expect(overlay.pingCount()).toBe(0);
    expect(scene.children).not.toContain(overlay.group);
  });
});
