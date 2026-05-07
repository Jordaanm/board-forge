// Component-level tests for the Table singleton's bounds derivation,
// presence detection, primitive switching, and locking enforcement
// (despawn / spawn-duplicate gates). Slices 1 + 5 of issues--table-refactor.md.

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { registerCorePrimitives } from '../spawnables';
import { TableComponent } from './TableComponent';
import { MeshComponent } from './MeshComponent';
import { TransformComponent } from './TransformComponent';
import { TABLE_ENTITY_ID } from '../tableEntity';

let scene: SceneImpl;
let ctx:   SpawnContext;

beforeEach(() => {
  registerCorePrimitives();
  scene = new SceneImpl();
  ctx = { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };
});

describe('TableComponent — presence detection', () => {
  test("Table spawnable carries a TableComponent", () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    expect(e.getComponent(TableComponent)).toBeDefined();
  });

  test('non-table entities do not carry a TableComponent', () => {
    const e = scene.spawn('die', ctx);
    expect(e.getComponent(TableComponent)).toBeUndefined();
  });

  test('Table is tagged "table" and "fixture"', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    expect(e.tags.sort()).toEqual(['fixture', 'table']);
  });
});

describe('Scene.getTable / getTableBounds', () => {
  test('getTable returns undefined when no table spawned', () => {
    expect(scene.getTable()).toBeUndefined();
  });

  test('getTableBounds returns defaults when no table spawned', () => {
    const b = scene.getTableBounds();
    expect(b.halfWidth).toBeCloseTo(6, 5);
    expect(b.halfDepth).toBeCloseTo(4, 5);
  });

  test('getTable returns the spawned Table entity', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    expect(scene.getTable()).toBe(e);
  });

  test('getTableBounds returns rect-table defaults at default scale', () => {
    scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const b = scene.getTableBounds();
    expect(b.halfWidth).toBeCloseTo(6, 5);
    expect(b.halfDepth).toBeCloseTo(4, 5);
  });

  test('getTableBounds returns circle-table defaults when meshRef switched', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const mesh = e.getComponent(MeshComponent)!;
    mesh.setState({ meshRef: 'prim:table-circle', size: [8, 0.3, 8] });
    const b = scene.getTableBounds();
    expect(b.halfWidth).toBeCloseTo(4, 5);
    expect(b.halfDepth).toBeCloseTo(4, 5);
  });

  test('getTableBounds scales linearly with uniform transform scale', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const t = e.getComponent(TransformComponent)!;
    t.setState({ position: t.state.position, rotation: t.state.rotation, scale: [3, 3, 3] });
    const b = scene.getTableBounds();
    expect(b.halfWidth).toBeCloseTo(18, 5);
    expect(b.halfDepth).toBeCloseTo(12, 5);
  });
});

describe('SceneImpl — Table locking gates (slice 5)', () => {
  test('despawn(TABLE_ENTITY_ID) throws with a descriptive error', () => {
    scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    expect(() => scene.despawn(TABLE_ENTITY_ID, ctx))
      .toThrowError(/Cannot despawn the Table/);
    expect(scene.getTable()).toBeDefined();  // still present
  });

  test('despawn with { force: true } bypasses the gate (replaceScene path)', () => {
    scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    expect(() => scene.despawn(TABLE_ENTITY_ID, ctx, { force: true })).not.toThrow();
    expect(scene.getTable()).toBeUndefined();
  });

  test('spawn("table", ...) throws when a Table already exists', () => {
    scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    expect(() => scene.spawn('table', ctx))
      .toThrowError(/singleton Table entity already exists/);
  });

  test('non-table despawns are unaffected', () => {
    scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const die = scene.spawn('die', ctx, { id: 'die-1' });
    expect(() => scene.despawn(die.id, ctx)).not.toThrow();
    expect(scene.has('die-1')).toBe(false);
  });
});
