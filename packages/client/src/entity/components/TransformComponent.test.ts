// Component-level invariant test for TransformComponent. Slice #7 of
// issues--property-schema-refactor.md — the schema declares min: 0.0001 on the
// uniform `scale` adapter, and the component's own setState re-clamps so any
// caller (editor, wire, scripts, tests) lands on a positive scale.

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { registerCorePrimitives } from '../spawnables';
import { TransformComponent } from './TransformComponent';
import { TABLE_ENTITY_ID } from '../tableEntity';

let scene:     SceneImpl;
let threeRoot: THREE.Scene;
let ctx:       SpawnContext;

beforeEach(() => {
  registerCorePrimitives();
  scene     = new SceneImpl();
  threeRoot = new THREE.Scene();
  ctx       = { scene: threeRoot, physics: new PhysicsWorld(), entityScene: scene };
});

describe('TransformComponent — scale invariant (issue #7 of property-schema-refactor)', () => {
  test('zero-scale write clamps each axis to 1', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: t.state.position, rotation: t.state.rotation, scale: [0, 0, 0] });
    expect(t.state.scale).toEqual([1, 1, 1]);
  });

  test('negative-scale write clamps each axis to 1', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: t.state.position, rotation: t.state.rotation, scale: [-2, -3, -1] });
    expect(t.state.scale).toEqual([1, 1, 1]);
  });

  test('positive-scale write passes through unchanged', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: t.state.position, rotation: t.state.rotation, scale: [1.5, 1.5, 1.5] });
    expect(t.state.scale).toEqual([1.5, 1.5, 1.5]);
  });

  test('NaN-scale write clamps to 1', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: t.state.position, rotation: t.state.rotation, scale: [Number.NaN, 1, 1] });
    expect(t.state.scale[0]).toBe(1);
  });
});
