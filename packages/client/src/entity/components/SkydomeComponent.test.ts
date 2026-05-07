// Component-level tests for the SkydomeComponent. Slice 2 of issues--table-refactor.md.

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { registerCorePrimitives } from '../spawnables';
import { SkydomeComponent } from './SkydomeComponent';
import { TABLE_ENTITY_ID } from '../tableEntity';

let scene:    SceneImpl;
let threeRoot: THREE.Scene;
let ctx:      SpawnContext;

beforeEach(() => {
  registerCorePrimitives();
  scene = new SceneImpl();
  threeRoot = new THREE.Scene();
  ctx = { scene: threeRoot, physics: new PhysicsWorld(), entityScene: scene };
});

describe('SkydomeComponent — lifecycle', () => {
  test('Table spawnable carries a SkydomeComponent with the default sky slug', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const sky = e.getComponent(SkydomeComponent);
    expect(sky).toBeDefined();
    expect(sky!.state.textureUrl).toBe('base:sky/default');
  });

  test('onSpawn attaches the skydome mesh to the THREE scene root', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const sky = e.getComponent(SkydomeComponent)!;
    expect(threeRoot.children.includes(sky.mesh)).toBe(true);
  });

  test('empty textureUrl renders the fallback colour (no texture map)', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const sky = e.getComponent(SkydomeComponent)!;
    sky.setState({ textureUrl: '' });
    const mat = sky.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeNull();
  });

  test('despawn removes the skydome from the THREE scene root', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const sky = e.getComponent(SkydomeComponent)!;
    const meshRef = sky.mesh;
    // Slice 5 gates Table despawn behind `{ force: true }`; that's the
    // contract for internal lifecycle paths like replaceScene.
    scene.despawn(TABLE_ENTITY_ID, ctx, { force: true });
    expect(threeRoot.children.includes(meshRef)).toBe(false);
  });
});

describe('SkydomeComponent — state changes', () => {
  test('setState({textureUrl}) mutates the underlying material colour to neutral while loading', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const sky = e.getComponent(SkydomeComponent)!;
    sky.setState({ textureUrl: 'http://nonexistent.example/sky.jpg' });
    expect(sky.state.textureUrl).toBe('http://nonexistent.example/sky.jpg');
  });

  test('reverting to empty textureUrl restores the fallback colour', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const sky = e.getComponent(SkydomeComponent)!;
    sky.setState({ textureUrl: 'http://example.com/sky.jpg' });
    sky.setState({ textureUrl: '' });
    const mat = sky.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeNull();
  });
});
