// Component-side consumer of the entity input lifecycle (issue #3 of
// issues--interaction.md). Subclasses override `onPress` / `onReleased` /
// `onClick` / `onHoverStart` / `onHoverEnd`; the base class registers bus
// listeners at attachComponent time so `entity.dispatchEvent('click', …)`
// reaches the override.

import { describe, test, expect } from 'vitest';
import { Entity } from './Entity';
import { EntityComponent } from './EntityComponent';
import { type InputEventPayload } from '../input/inputEvents';

interface RecordedCall {
  hook:    string;
  payload: InputEventPayload;
}

class LogInputComponent extends EntityComponent<{}> {
  static typeId = 'log-input';
  calls: RecordedCall[] = [];
  onSpawn(): void {}
  onPropertiesChanged(): void {}
  onPress      (p: InputEventPayload): void { this.calls.push({ hook: 'pressed',     payload: p }); }
  onReleased   (p: InputEventPayload): void { this.calls.push({ hook: 'released',    payload: p }); }
  onClick      (p: InputEventPayload): void { this.calls.push({ hook: 'click',       payload: p }); }
  onHoverStart (p: InputEventPayload): void { this.calls.push({ hook: 'hover-start', payload: p }); }
  onHoverEnd   (p: InputEventPayload): void { this.calls.push({ hook: 'hover-end',   payload: p }); }
}

class NoOverrideComponent extends EntityComponent<{}> {
  static typeId = 'no-override';
  onSpawn(): void {}
  onPropertiesChanged(): void {}
}

function makeEntityWith<T extends EntityComponent<{}>>(comp: T): { entity: Entity; comp: T } {
  comp.state = {};
  const entity = new Entity({ id: 'e', type: 'token', name: 'e' });
  entity.attachComponent(comp);
  return { entity, comp };
}

const PAYLOAD: InputEventPayload = {
  seat:     0,
  shiftKey: false,
  ctrlKey:  false,
  altKey:   false,
  worldHit: { x: 1, y: 2, z: 3 },
};

describe('EntityComponent — input lifecycle hooks', () => {
  test('onClick fires when the entity bus dispatches click, with the payload', () => {
    const { entity, comp } = makeEntityWith(new LogInputComponent());
    entity.dispatchEvent('click', PAYLOAD);
    expect(comp.calls).toEqual([{ hook: 'click', payload: PAYLOAD }]);
  });

  test('all five hooks route through the bus to the override', () => {
    const { entity, comp } = makeEntityWith(new LogInputComponent());
    entity.dispatchEvent('pressed',     PAYLOAD);
    entity.dispatchEvent('released',    PAYLOAD);
    entity.dispatchEvent('click',       PAYLOAD);
    entity.dispatchEvent('hover-start', PAYLOAD);
    entity.dispatchEvent('hover-end',   PAYLOAD);
    expect(comp.calls.map(c => c.hook)).toEqual([
      'pressed', 'released', 'click', 'hover-start', 'hover-end',
    ]);
  });

  test('default base-class hooks are no-ops — dispatch on a non-overriding component does not throw', () => {
    const { entity } = makeEntityWith(new NoOverrideComponent());
    expect(() => entity.dispatchEvent('click', PAYLOAD)).not.toThrow();
    expect(() => entity.dispatchEvent('hover-start', PAYLOAD)).not.toThrow();
  });

  test('multiple components on the same entity each receive the event', () => {
    class A extends LogInputComponent { static typeId = 'a'; }
    class B extends LogInputComponent { static typeId = 'b'; }
    const a = new A();
    const b = new B();
    a.state = {};
    b.state = {};
    const entity = new Entity({ id: 'e', type: 'token', name: 'e' });
    entity.attachComponent(a);
    entity.attachComponent(b);
    entity.dispatchEvent('click', PAYLOAD);
    expect(a.calls.map(c => c.hook)).toEqual(['click']);
    expect(b.calls.map(c => c.hook)).toEqual(['click']);
  });

  test('script addEventListener and component override fire on the same dispatch', () => {
    const { entity, comp } = makeEntityWith(new LogInputComponent());
    const scriptCalls: InputEventPayload[] = [];
    entity.addEventListener('click', (p) => scriptCalls.push(p as InputEventPayload));
    entity.dispatchEvent('click', PAYLOAD);
    expect(comp.calls).toHaveLength(1);
    expect(scriptCalls).toEqual([PAYLOAD]);
  });
});
