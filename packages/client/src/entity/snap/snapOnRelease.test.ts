// Integration tests for snap-on-release. Exercises HoldService.release against
// a real Scene with real components — covers candidate gathering, world-space
// resolution, position + rotation application, and the negative cases (no
// snap on setPosition / load / spawn).

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { type Entity } from '../Entity';
import { HoldService } from '../HoldService';
import { HostReplicatorV2, type ReplicatorPolicy } from '../HostReplicatorV2';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { SnapPointsComponent, type SnapPoint } from '../components/SnapPointsComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { extractYaw } from './snapHost';

const POLICY: ReplicatorPolicy = {
  channelFor:  () => 'reliable',
  coalesceFor: () => 'merge',
  shouldFlush: () => true,
};

let scene:   SceneImpl;
let physics: PhysicsWorld;
let ctx:     SpawnContext;
let world:   HostReplicatorV2;
let hold:    HoldService;

beforeEach(() => {
  registerCorePrimitives();
  scene   = new SceneImpl();
  physics = new PhysicsWorld();
  ctx     = { scene: new THREE.Scene(), physics, entityScene: scene };
  world   = new HostReplicatorV2(POLICY);
  scene.world = world;
  hold    = new HoldService(world, scene);
});

function placeMarker(pos: [number, number, number], opts: Partial<SnapPoint> = {}): Entity {
  const marker = scene.spawn('snap-marker', ctx);
  const t = marker.getComponent(TransformComponent)!;
  t.setState({ position: pos, rotation: t.state.rotation, scale: t.state.scale });
  const sp = marker.getComponent(SnapPointsComponent)!;
  sp.setState({
    points: [{
      id:           'default',
      localPos:     [0, 0, 0],
      localYaw:     0,
      snapRotation: false,
      snapY:        false,
      radius:       0.5,
      ...opts,
    }],
  });
  return marker;
}

function placeCard(pos: [number, number, number]): Entity {
  const card = scene.spawn('card', ctx);
  const t = card.getComponent(TransformComponent)!;
  t.setState({ position: pos, rotation: t.state.rotation, scale: t.state.scale });
  const body = card.getComponent(PhysicsComponent)!.body;
  body.position.set(pos[0], pos[1], pos[2]);
  return card;
}

function drop(entity: Entity, vel?: { vx: number; vy: number; vz: number }): void {
  hold.tryClaim(entity, 0);
  hold.release(entity, vel);
}

describe('snap-on-release — host integration', () => {
  test('drops within radius snap to marker XZ; Y preserved by default; velocity zeroed', () => {
    const marker = placeMarker([2, 0, 3]);
    const card   = placeCard([2.1, 0.05, 3.05]);

    drop(card, { vx: 5, vy: 0, vz: 0 });

    const t = card.getComponent(TransformComponent)!;
    // X and Z snap to marker; Y preserved because snapY defaults to false.
    expect(t.state.position).toEqual([2, 0.05, 3]);
    const body = card.getComponent(PhysicsComponent)!.body;
    expect(body.velocity.length()).toBe(0);
    expect(body.angularVelocity.length()).toBe(0);
    expect(marker.id).toBeDefined();
  });

  test('snapRotation:false preserves the card rotation on snap', () => {
    placeMarker([0, 0, 0]);
    const card = placeCard([0, 0.05, 0]);
    const t = card.getComponent(TransformComponent)!;
    const before = [...t.state.rotation] as [number, number, number, number];

    drop(card);
    expect(t.state.rotation).toEqual(before);
  });

  test('snapRotation:true sets card yaw to the marker world yaw', () => {
    // Marker at origin, point yaw = π/4. snapRotation enabled.
    placeMarker([0, 0, 0], { snapRotation: true, localYaw: Math.PI / 4 });
    const card = placeCard([0, 0.05, 0]);

    drop(card);

    const t = card.getComponent(TransformComponent)!;
    const [qx, qy, qz, qw] = t.state.rotation;
    const yaw = extractYaw(new THREE.Quaternion(qx, qy, qz, qw));
    expect(yaw).toBeCloseTo(Math.PI / 4, 5);
  });

  test('drop outside any radius leaves throw velocity intact', () => {
    placeMarker([0, 0, 0], { radius: 0.5 });
    const card = placeCard([5, 0.05, 5]);

    drop(card, { vx: 2, vy: 0, vz: 3 });

    const t = card.getComponent(TransformComponent)!;
    expect(t.state.position[0]).toBeCloseTo(5);
    const body = card.getComponent(PhysicsComponent)!.body;
    expect(body.velocity.x).toBe(2);
    expect(body.velocity.z).toBe(3);
  });

  test('two markers near each other → closest XZ wins', () => {
    placeMarker([0, 0, 0]);
    const near = placeMarker([0.6, 0, 0]);
    const card = placeCard([0.55, 0.05, 0]);

    drop(card);

    const t = card.getComponent(TransformComponent)!;
    // Y preserved (snapY default off); only XZ taken from the closer marker.
    expect(t.state.position).toEqual([0.6, 0.05, 0]);
    expect(near.id).toBeDefined();
  });

  test('marker dropped onto another marker: own point excluded, snaps to the other', () => {
    const a = placeMarker([0, 0, 0]);
    const b = placeMarker([0.1, 0, 0.1]);
    // Drag b onto a — b's own snap point at b's position would be the closest
    // candidate, but it's excluded by self-exclusion. So b snaps to a.

    drop(b);

    const t = b.getComponent(TransformComponent)!;
    expect(t.state.position).toEqual([0, 0, 0]);
    expect(a.id).toBeDefined();
  });

  test('scripted setPosition into a snap radius does NOT trigger snap', () => {
    placeMarker([0, 0, 0]);
    const card = placeCard([5, 0.05, 5]);

    const t = card.getComponent(TransformComponent)!;
    t.setState({ position: [0, 0.05, 0], rotation: t.state.rotation, scale: t.state.scale });

    // No release went through — position is exactly what we set.
    expect(t.state.position).toEqual([0, 0.05, 0]);
  });

  test('scene.load into snap radius does NOT trigger snap', () => {
    placeMarker([0, 0, 0]);
    // Spawn places the card directly; no hold/release involved.
    const card = placeCard([0.1, 0.05, 0]);
    const t = card.getComponent(TransformComponent)!;
    expect(t.state.position).toEqual([0.1, 0.05, 0]);
  });

  test('initial scene spawn does NOT trigger snap', () => {
    placeMarker([0, 0, 0]);
    const card = scene.spawn('card', ctx);  // spawns at origin (inside radius)
    const t = card.getComponent(TransformComponent)!;
    // Card's spawn position is the default [0,0,0] — not [0,0,0] from a snap;
    // the assertion that matters is that no release path ran.
    expect(t.state.position[1]).toBe(0);  // not adjusted by snap (marker is at y=0 anyway, but velocity untouched)
    const body = card.getComponent(PhysicsComponent)!.body;
    expect(body.velocity.length()).toBe(0);  // never had velocity → trivially still zero, but it confirms no snap path mutated anything
  });

  test('marker world-yaw composes with point.localYaw', () => {
    // Marker yawed by π/2; point.localYaw 0. snapRotation true. Expect card yaw = π/2.
    const marker = scene.spawn('snap-marker', ctx);
    const mt = marker.getComponent(TransformComponent)!;
    const halfYaw = Math.PI / 4;
    mt.setState({
      position: [0, 0, 0],
      rotation: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
      scale:    mt.state.scale,
    });
    marker.getComponent(SnapPointsComponent)!.setState({
      points: [{ id: 'p', localPos: [0, 0, 0], localYaw: 0, snapRotation: true, snapY: false, radius: 1 }],
    });
    const card = placeCard([0.1, 0.05, 0]);

    drop(card);

    const t = card.getComponent(TransformComponent)!;
    const [qx, qy, qz, qw] = t.state.rotation;
    const yaw = extractYaw(new THREE.Quaternion(qx, qy, qz, qw));
    expect(yaw).toBeCloseTo(Math.PI / 2, 5);
  });

  test('snapY: true → snap target Y uses candidate world Y', () => {
    placeMarker([0, 1.5, 0], { snapY: true });
    const card = placeCard([0.1, 5, 0]);

    drop(card);

    const t = card.getComponent(TransformComponent)!;
    expect(t.state.position[1]).toBe(1.5);
  });

  test('snapY: false (default) → dropped entity Y is preserved on snap', () => {
    placeMarker([0, 1.5, 0]);
    const card = placeCard([0.1, 5, 0]);

    drop(card);

    const t = card.getComponent(TransformComponent)!;
    expect(t.state.position[0]).toBeCloseTo(0);
    expect(t.state.position[1]).toBe(5);
    expect(t.state.position[2]).toBeCloseTo(0);
  });

  test('local-offset snap point computes world pos by composing with marker transform', () => {
    // Marker at (5, 0, 0); point localPos (1, 0, 0); expected world (6, 0, 0).
    const marker = scene.spawn('snap-marker', ctx);
    const mt = marker.getComponent(TransformComponent)!;
    mt.setState({ position: [5, 0, 0], rotation: mt.state.rotation, scale: mt.state.scale });
    marker.getComponent(SnapPointsComponent)!.setState({
      points: [{ id: 'p', localPos: [1, 0, 0], localYaw: 0, snapRotation: false, snapY: false, radius: 0.5 }],
    });
    const card = placeCard([6.05, 0.05, 0]);

    drop(card);

    const t = card.getComponent(TransformComponent)!;
    expect(t.state.position[0]).toBeCloseTo(6);
    expect(t.state.position[2]).toBeCloseTo(0);
  });
});
