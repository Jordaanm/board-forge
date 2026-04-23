import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SceneGraph, type SceneEntry } from './SceneGraph';
import { TABLE_SURFACE_Y, TABLE_WIDTH } from './Table';
import { type PhysicsWorld } from '../physics/PhysicsWorld';

function makeEntry(graph: SceneGraph): SceneEntry {
  const scene = new THREE.Scene();
  const fakePhysics = { addBody: () => {} } as unknown as PhysicsWorld;
  return graph.spawn('die', scene, fakePhysics);
}

describe('SceneGraph.enforceTableBounds', () => {
  test('records rest pose when body settles on the table', () => {
    const graph = new SceneGraph();
    const entry = makeEntry(graph);
    const body  = entry.body as CANNON.Body;

    body.position.set(1.0, TABLE_SURFACE_Y + 0.35, -0.5);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.setZero();
    body.angularVelocity.setZero();

    graph.enforceTableBounds();

    expect(entry.restPose).toMatchObject({ px: 1.0, pz: -0.5 });
    expect(entry.restPose!.py).toBeCloseTo(TABLE_SURFACE_Y + 0.35);
  });

  test('does not record rest pose while body is at carry height', () => {
    const graph = new SceneGraph();
    const entry = makeEntry(graph);
    const body  = entry.body as CANNON.Body;
    const initialRest = entry.restPose;

    body.position.set(0, TABLE_SURFACE_Y + 1.5, 0);
    body.velocity.setZero();
    body.angularVelocity.setZero();

    graph.enforceTableBounds();

    expect(entry.restPose).toEqual(initialRest);
  });

  test('does not record rest pose while body is moving', () => {
    const graph = new SceneGraph();
    const entry = makeEntry(graph);
    const body  = entry.body as CANNON.Body;
    const initialRest = entry.restPose;

    body.position.set(2, TABLE_SURFACE_Y + 0.35, 1);
    body.velocity.set(0, 0, 1.0);

    graph.enforceTableBounds();

    expect(entry.restPose).toEqual(initialRest);
  });

  test('snaps body back to last rest pose when fallen below table', () => {
    const graph = new SceneGraph();
    const entry = makeEntry(graph);
    const body  = entry.body as CANNON.Body;

    body.position.set(2.5, TABLE_SURFACE_Y + 0.35, -1.0);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    graph.enforceTableBounds();

    body.position.set(TABLE_WIDTH, TABLE_SURFACE_Y - 5, 0);
    body.velocity.set(3, -8, 0);
    body.angularVelocity.set(2, 1, 0);

    graph.enforceTableBounds();

    expect(body.position.x).toBeCloseTo(2.5);
    expect(body.position.y).toBeCloseTo(TABLE_SURFACE_Y + 0.35);
    expect(body.position.z).toBeCloseTo(-1.0);
    expect(body.velocity.length()).toBe(0);
    expect(body.angularVelocity.length()).toBe(0);
  });

  test('falls back to spawn pose when body fell off without ever settling', () => {
    const graph = new SceneGraph();
    const entry = makeEntry(graph);
    const body  = entry.body as CANNON.Body;
    const spawn = { ...entry.restPose! };

    body.position.set(0, TABLE_SURFACE_Y - 10, 0);
    graph.enforceTableBounds();

    expect(body.position.x).toBeCloseTo(spawn.px);
    expect(body.position.y).toBeCloseTo(spawn.py);
    expect(body.position.z).toBeCloseTo(spawn.pz);
  });

  test('ignores entries without a body (guest mirror entries)', () => {
    const graph = new SceneGraph();
    const scene = new THREE.Scene();
    graph.ensureObjects(
      [{ id: 'die-99', objectType: 'die',
         px: 0, py: TABLE_SURFACE_Y - 10, pz: 0,
         qx: 0, qy: 0, qz: 0, qw: 1 }],
      scene,
    );
    expect(() => graph.enforceTableBounds()).not.toThrow();
  });
});
