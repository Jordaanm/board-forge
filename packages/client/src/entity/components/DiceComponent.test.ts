import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { aggregateContextMenu } from '../contextMenu';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { ValueComponent } from './ValueComponent';
import { DiceComponent } from './DiceComponent';
import { registerCorePrimitives } from '../spawnables';
import { PhysicsWorld } from '../../physics/PhysicsWorld';
import { resolveFaceFromOrientation } from '../../dice/diceFaceResolver';
import { D6_FACE_MAP } from '../../dice/d6';

let scene: SceneImpl;
let ctx: SpawnContext;

beforeEach(() => {
  registerCorePrimitives();
  scene = new SceneImpl();
  ctx = { scene: new THREE.Scene(), physics: new PhysicsWorld(), entityScene: scene };
});

// Drive PhysicsComponent through one moving → stopped transition with the body
// at the supplied quaternion. Exercises the same syncToTransform path the host
// loop runs each tick.
function triggerStopAtOrientation(
  phys: PhysicsComponent,
  qx: number, qy: number, qz: number, qw: number,
): void {
  phys.body.quaternion.set(qx, qy, qz, qw);
  phys.body.velocity.set(1, 0, 0);
  phys.syncToTransform();
  phys.body.velocity.setZero();
  phys.body.angularVelocity.setZero();
  phys.syncToTransform();
}

describe('DiceComponent — roll()', () => {
  test('wakes the body and produces non-zero angular velocity', () => {
    const e = scene.spawn('die', ctx);
    const phys = e.getComponent(PhysicsComponent)!;
    phys.body.sleep();

    e.getComponent(DiceComponent)!.roll();

    expect(phys.body.angularVelocity.length()).toBeGreaterThan(0);
    expect(phys.body.sleepState).not.toBe(2 /* CANNON.Body.SLEEPING */);
  });
});

describe('DiceComponent — setValue()', () => {
  test.each(D6_FACE_MAP.map(f => f.value))('writes value %i and orients accordingly', (v) => {
    const e = scene.spawn('die', ctx);
    const dice  = e.getComponent(DiceComponent)!;
    const phys  = e.getComponent(PhysicsComponent)!;
    const value = e.getComponent(ValueComponent)!;

    phys.body.velocity.set(5, 5, 5);
    phys.body.angularVelocity.set(5, 5, 5);

    dice.setValue(v);

    expect(value.state.value).toBe(String(v));
    expect(phys.body.velocity.length()).toBe(0);
    expect(phys.body.angularVelocity.length()).toBe(0);

    const q = phys.body.quaternion;
    expect(resolveFaceFromOrientation(q.x, q.y, q.z, q.w, dice.state.faceMap)).toBe(v);
  });
});

describe('DiceComponent — stop-moving subscription', () => {
  test('writes the resolver-determined face into ValueComponent on rest', () => {
    const e = scene.spawn('die', ctx);
    const phys  = e.getComponent(PhysicsComponent)!;
    const value = e.getComponent(ValueComponent)!;

    // 180° around X → face 6 up.
    triggerStopAtOrientation(phys, 1, 0, 0, 0);
    expect(value.state.value).toBe('6');

    // Identity → face 1 up.
    triggerStopAtOrientation(phys, 0, 0, 0, 1);
    expect(value.state.value).toBe('1');
  });

  test('cocked rest pose still resolves to the closest face', () => {
    const e = scene.spawn('die', ctx);
    const phys  = e.getComponent(PhysicsComponent)!;
    const value = e.getComponent(ValueComponent)!;

    // 30° around Z — localUp is mostly +Y but tipped toward +X. Face 1 wins.
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), Math.PI / 6,
    );
    triggerStopAtOrientation(phys, q.x, q.y, q.z, q.w);
    expect(value.state.value).toBe('1');
  });
});

describe('DiceComponent — onDespawn', () => {
  test('unsubscribes from stop-moving so later transitions do not write', () => {
    const e = scene.spawn('die', ctx);
    const phys  = e.getComponent(PhysicsComponent)!;
    const value = e.getComponent(ValueComponent)!;

    // Land on face 1 once so we have a known baseline.
    triggerStopAtOrientation(phys, 0, 0, 0, 1);
    expect(value.state.value).toBe('1');

    scene.despawn(e.id, ctx);

    // After despawn, settling at face-6 orientation must not update value.
    triggerStopAtOrientation(phys, 1, 0, 0, 0);
    expect(value.state.value).toBe('1');
  });
});

describe('DiceComponent — context menu', () => {
  test('returns Roll action and disabled "Value: N" reading from ValueComponent', () => {
    const e = scene.spawn('die', ctx);
    e.getComponent(ValueComponent)!.setState({ value: '4', isNumeric: true });

    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    const dice  = items.filter(i => i.kind === 'action' && (i as { componentTypeId?: string }).componentTypeId === 'dice');

    expect(dice).toHaveLength(2);
    const [roll, info] = dice as Array<{ kind: 'action'; id: string; label: string; disabled?: boolean }>;
    expect(roll.id).toBe('roll');
    expect(roll.label).toBe('Roll');
    expect(roll.disabled).toBeFalsy();
    expect(info.id).toBe('value');
    expect(info.label).toBe('Value: 4');
    expect(info.disabled).toBe(true);
  });

  test('ValueComponent contributes no items to the menu', () => {
    const e = scene.spawn('die', ctx);
    const items = aggregateContextMenu(e, { recipientSeat: 0, isHost: true, entity: e });
    const valueItems = items.filter(
      i => (i.kind === 'action' || i.kind === 'colorpicker')
        && (i as { componentTypeId?: string }).componentTypeId === 'value',
    );
    expect(valueItems).toEqual([]);
  });
});

describe('DiceComponent — round-trip', () => {
  test('state survives JSON serialise / deserialise', () => {
    const e = scene.spawn('die', ctx, { id: 'd1' });
    const dice = e.getComponent(DiceComponent)!;
    const cloned = JSON.parse(JSON.stringify(dice.toJSON())) as { maxValue: number; faceMap: typeof D6_FACE_MAP };
    expect(cloned.maxValue).toBe(6);
    expect(cloned.faceMap).toEqual(D6_FACE_MAP);
  });
});
