import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { type Entity } from '../Entity';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { TweenComponent } from './TweenComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { HoldService } from '../HoldService';
import { HostReplicatorV2, type ReplicatorPolicy } from '../HostReplicatorV2';
import { createWorld } from '../world';
import { createInMemoryBusPair } from '../world/InMemoryTransport';

const POLICY: ReplicatorPolicy = {
  channelFor:  () => 'reliable',
  coalesceFor: () => 'merge',
  shouldFlush: () => true,
};

let scene:   SceneImpl;
let ctx:     SpawnContext;
let physics: PhysicsWorld;

beforeEach(() => {
  registerCorePrimitives();
  scene   = new SceneImpl();
  physics = new PhysicsWorld();
  ctx     = { scene: new THREE.Scene(), physics, entityScene: scene };
});

function placeAt(entity: Entity, x: number, y: number, z: number): void {
  const t = entity.getComponent(TransformComponent)!;
  t.setState({ position: [x, y, z], rotation: t.state.rotation, scale: t.state.scale });
  const phys = entity.getComponent(PhysicsComponent);
  if (phys) phys.body.position.set(x, y, z);
}

describe('TweenComponent — interpolation', () => {
  test('linearly interpolates position with ease-out cubic curve', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    placeAt(e, 0, 0, 0);

    tween.tweenTo({ position: [10, 0, 0] }, 1000);
    expect(tween.isActive()).toBe(true);

    // At t=0.5 linear, ease-out cubic gives 1 - 0.5^3 = 0.875.
    tween.tick(0.5);
    const t = e.getComponent(TransformComponent)!;
    expect(t.state.position[0]).toBeCloseTo(8.75, 5);

    // Reach end.
    tween.tick(0.5);
    expect(tween.isActive()).toBe(false);
    expect(t.state.position[0]).toBeCloseTo(10, 5);
  });

  test('slerps rotation when target rotation supplied', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: t.state.position, rotation: [0, 0, 0, 1], scale: t.state.scale });

    // 180° rotation about X.
    tween.tweenTo({ position: [0, 0, 0], rotation: [1, 0, 0, 0] }, 1000);
    tween.tick(1);

    const [rx, , , rw] = t.state.rotation;
    // Expect arrival at the target quaternion.
    expect(rx).toBeCloseTo(1, 5);
    expect(rw).toBeCloseTo(0, 5);
  });

  test('omitting rotation in tweenTo leaves rotation untouched', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const t = e.getComponent(TransformComponent)!;
    const initialRotation: [number, number, number, number] = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)];
    t.setState({ position: t.state.position, rotation: initialRotation, scale: t.state.scale });

    tween.tweenTo({ position: [5, 5, 5] }, 500);
    tween.tick(0.5);

    expect(t.state.rotation).toEqual(initialRotation);
  });
});

describe('TweenComponent — physics suspension and restoration', () => {
  test('on tween start stashes mass and collisionResponse, sets frozen-passthrough', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;

    expect(phys.body.mass).toBe(0.2);
    expect(phys.body.collisionResponse).toBe(true);

    tween.tweenTo({ position: [1, 0, 0] }, 1000);
    expect(phys.body.mass).toBe(0);
    expect(phys.body.collisionResponse).toBe(false);
  });

  test('on tween completion restores the stashed values', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;

    tween.tweenTo({ position: [1, 0, 0] }, 100);
    tween.tick(0.2);
    expect(tween.isActive()).toBe(false);
    expect(phys.body.mass).toBe(0.2);
    expect(phys.body.collisionResponse).toBe(true);
  });

  test('cancel() restores the stashed values and is idempotent', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;

    tween.tweenTo({ position: [10, 0, 0] }, 1000);
    tween.cancel();
    expect(tween.isActive()).toBe(false);
    expect(phys.body.mass).toBe(0.2);
    expect(phys.body.collisionResponse).toBe(true);

    // Second cancel is a no-op.
    expect(() => tween.cancel()).not.toThrow();
    expect(phys.body.mass).toBe(0.2);
  });

  test('cancel preserves mid-flight pose (does not snap to start or target)', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const t     = e.getComponent(TransformComponent)!;
    placeAt(e, 0, 0, 0);

    tween.tweenTo({ position: [10, 0, 0] }, 1000);
    tween.tick(0.5);
    const midX = t.state.position[0];
    tween.cancel();
    expect(t.state.position[0]).toBe(midX);
  });
});

describe('TweenComponent — restart-from-current', () => {
  test('tweenTo while active cancels the previous tween and starts from current pose', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const t     = e.getComponent(TransformComponent)!;
    placeAt(e, 0, 0, 0);

    tween.tweenTo({ position: [10, 0, 0] }, 1000);
    tween.tick(0.5);
    const midX = t.state.position[0];
    expect(midX).toBeGreaterThan(0);
    expect(midX).toBeLessThan(10);

    // Redirect to a different target. Should start interpolating from midX,
    // not from 0 (the original start).
    tween.tweenTo({ position: [-5, 0, 0] }, 1000);
    tween.tick(0.5);
    // New start was midX, target -5; eased t at 0.5 = 0.875.
    const expectedX = midX + (-5 - midX) * 0.875;
    expect(t.state.position[0]).toBeCloseTo(expectedX, 5);
  });
});

describe('TweenComponent — body sync for sensor AABBs', () => {
  test('per-frame writes interpolated position to body.position', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;
    placeAt(e, 0, 0, 0);

    tween.tweenTo({ position: [4, 2, 1] }, 1000);
    tween.tick(0.5);

    expect(phys.body.position.x).toBeCloseTo(4 * 0.875, 5);
    expect(phys.body.position.y).toBeCloseTo(2 * 0.875, 5);
    expect(phys.body.position.z).toBeCloseTo(1 * 0.875, 5);
  });
});

describe('Entity.cancelTween — cancel hooks', () => {
  test('Entity.cancelTween() no-ops on entities without TweenComponent', () => {
    const e = scene.spawn('board', ctx); // board has no tween
    expect(() => e.cancelTween()).not.toThrow();
  });

  test('PhysicsComponent.applyImpulse cancels active tween before applying', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;

    tween.tweenTo({ position: [5, 5, 5] }, 1000);
    expect(tween.isActive()).toBe(true);
    expect(phys.body.mass).toBe(0);

    phys.applyImpulse({ x: 1, y: 0, z: 0 });
    expect(tween.isActive()).toBe(false);
    expect(phys.body.mass).toBe(0.2);
    expect(phys.body.velocity.length()).toBeGreaterThan(0);
  });

  test('HoldService.tryClaim cancels active tween before claiming', () => {
    scene.world = new HostReplicatorV2(POLICY);
    const hold  = new HoldService(scene.world as HostReplicatorV2, scene);

    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    tween.tweenTo({ position: [5, 5, 5] }, 1000);
    expect(tween.isActive()).toBe(true);

    expect(hold.tryClaim(e, 0)).toBe(true);
    expect(tween.isActive()).toBe(false);
    expect(e.heldBy).toBe(0);
  });
});

describe('TweenComponent — snap to target on serialization', () => {
  test('snapToTarget writes target pose into transform and physics body', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const t     = e.getComponent(TransformComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;
    placeAt(e, 0, 0, 0);

    tween.tweenTo({ position: [3, 3, 3], rotation: [1, 0, 0, 0] }, 1000);
    tween.tick(0.1); // partial progress

    tween.snapToTarget();
    expect(tween.isActive()).toBe(false);
    expect(t.state.position).toEqual([3, 3, 3]);
    expect(t.state.rotation).toEqual([1, 0, 0, 0]);
    expect(phys.body.position.x).toBe(3);
    expect(phys.body.mass).toBe(0.2);
  });

  test('toJSON returns empty object — no persistent state', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    tween.tweenTo({ position: [9, 9, 9] }, 1000);
    expect(tween.toJSON()).toEqual({});
  });
});

describe('TweenComponent — World.snapshot pre-snaps active tweens', () => {
  test('snapshot captures the target pose for an in-flight tween', () => {
    const bus = createInMemoryBusPair();
    const host = createWorld({
      role:      'host',
      scene:     new THREE.Scene(),
      identity:  { isHost: true, selfSeat: () => 0, selfPeerId: () => 'h' },
      transport: bus.host,
    });
    try {
      const handle = host.spawn('die', { id: 'die-snap', position: [0, 1, 0] });
      const tween = handle.get(TweenComponent)!;
      tween.tweenTo({ position: [5, 1, 0] }, 1000);
      tween.tick(0.1);  // partial progress

      const snap = host.snapshot();
      const die  = snap.find(s => s.id === 'die-snap')!;
      const transform = die.components.transform as { position: [number, number, number] };
      expect(transform.position[0]).toBeCloseTo(5, 5);
      expect(tween.isActive()).toBe(false);
    } finally {
      host.dispose();
    }
  });
});

describe('TweenComponent — onDespawn', () => {
  test('despawning while a tween is active cancels it cleanly', () => {
    const e = scene.spawn('die', ctx);
    const tween = e.getComponent(TweenComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;

    tween.tweenTo({ position: [5, 0, 0] }, 1000);
    expect(phys.body.mass).toBe(0);

    scene.despawn(e.id, ctx);
    expect(phys.body.mass).toBe(0.2); // restored before component teardown
  });
});
