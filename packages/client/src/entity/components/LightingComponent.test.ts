// Component-level tests for the LightingComponent. Slice 3 of issues--table-refactor.md.

import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { registerCorePrimitives } from '../spawnables';
import { LightingComponent } from './LightingComponent';
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

describe('LightingComponent — lifecycle', () => {
  test('Table spawnable carries a LightingComponent with default state', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    expect(lighting).toBeDefined();
    expect(lighting.state.keyColor).toBe('#fff1dc');
    expect(lighting.state.keyIntensity).toBeCloseTo(1.1, 5);
  });

  test('onSpawn attaches the directional light to the THREE scene root', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    expect(threeRoot.children.includes(lighting.light)).toBe(true);
  });

  test('default light reflects spawnable state', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    expect(lighting.light.intensity).toBeCloseTo(1.1, 5);
    expect('#' + lighting.light.color.getHexString()).toBe('#fff1dc');
  });

  test('despawn removes the light from the THREE scene root', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    const lightRef = lighting.light;
    scene.despawn(TABLE_ENTITY_ID, ctx);
    expect(threeRoot.children.includes(lightRef)).toBe(false);
  });
});

describe('LightingComponent — state changes', () => {
  test('setState({keyColor}) updates the underlying directional light colour', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    lighting.setState({ keyColor: '#ff0000' });
    expect('#' + lighting.light.color.getHexString()).toBe('#ff0000');
  });

  test('setState({keyIntensity}) updates the underlying directional light intensity', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    lighting.setState({ keyIntensity: 2.5 });
    expect(lighting.light.intensity).toBeCloseTo(2.5, 5);
  });

  test('negative intensity clamps to 0 via applyKeyLightProp', () => {
    const e = scene.spawn('table', ctx, { id: TABLE_ENTITY_ID });
    const lighting = e.getComponent(LightingComponent)!;
    lighting.setState({ keyIntensity: -1 });
    expect(lighting.light.intensity).toBe(0);
  });
});
