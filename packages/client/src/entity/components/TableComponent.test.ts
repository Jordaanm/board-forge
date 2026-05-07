// Component-level tests for the Table singleton's bounds derivation,
// presence detection, and primitive switching. Locking enforcement (despawn
// guard, spawn-duplicate guard) is slice 5 of issues--table-refactor.md.

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
