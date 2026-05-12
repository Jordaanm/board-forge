// Orchestrates dice behaviour by composing the sibling Transform / Physics /
// Value components. State is set once at spawn from the spawnable definition
// and never mutated — replicating it lets guests rebuild the face resolver.
// Slice 2 of issues--dice.md.

import {
  EntityComponent,
  type SpawnContext,
  type MenuItem,
  type ActionContext,
  type ActionDefinition,
} from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { ValueComponent } from './ValueComponent';
import {
  resolveFaceFromOrientation,
  orientationForValue,
  type FaceEntry,
} from '../../dice/diceFaceResolver';

export interface DiceState {
  maxValue: number;
  faceMap:  FaceEntry[];
}

const ROLL_ANGULAR = 40;
const ROLL_LINEAR  = 4;
const ROLL_TOSS    = 3;

export class DiceComponent extends EntityComponent<DiceState> {
  static typeId   = 'dice';
  static requires = ['transform', 'physics', 'value'] as const;

  private unsubscribeStop: (() => void) | null = null;

  onSpawn(_ctx: SpawnContext): void {
    const phys = this.entity.getComponent(PhysicsComponent);
    if (!phys) return;
    this.unsubscribeStop = phys.subscribeStopMoving(() => this.handleStopMoving());
  }

  onDespawn(_ctx: SpawnContext): void {
    if (this.unsubscribeStop) {
      this.unsubscribeStop();
      this.unsubscribeStop = null;
    }
  }

  onPropertiesChanged(_changed: Partial<DiceState>): void { /* state is immutable */ }

  getActions(_ctx: ActionContext): ActionDefinition[] {
    return [
      { name: 'roll',       label: 'Roll' },
      { name: 'rotate-cw',  label: 'Rotate' },
      { name: 'rotate-ccw', label: 'Rotate Counter Clockwise' },
    ];
  }

  // Read-only "Value: N" surfaces the current face on the menu without being
  // an action — lives on the menu-controls track as a disabled action item.
  getMenuControls(_ctx: ActionContext): MenuItem[] {
    const value = this.entity.getComponent(ValueComponent)?.state.value ?? '?';
    return [
      { kind: 'action', id: 'value', label: `Value: ${value}`, disabled: true },
    ];
  }

  onAction(name: string, _ctx: ActionContext): void {
    if (name === 'roll')        { this.roll();           return; }
    if (name === 'rotate-cw')   { this.stepValue(+1);    return; }
    if (name === 'rotate-ccw')  { this.stepValue(-1);    return; }
  }

  // Increment / decrement the die's face value with wraparound across
  // [1, maxValue]. Reuses setValue so the model snaps to the orientation
  // matching the new face.
  private stepValue(delta: number): void {
    const valueComp = this.entity.getComponent(ValueComponent);
    if (!valueComp) return;
    const max = this.state.maxValue;
    if (!Number.isFinite(max) || max < 1) return;
    const current = Number(valueComp.state.value);
    const base    = Number.isFinite(current) ? current : 1;
    // Map 1..max → 0..max-1, step, wrap, map back.
    const next = ((base - 1 + delta) % max + max) % max + 1;
    this.setValue(next);
  }

  // ── Public API ─────────────────────────────────────────────────────────
  roll(): void {
    const phys = this.entity.getComponent(PhysicsComponent);
    if (!phys?.body) return;
    phys.body.wakeUp();
    phys.body.angularVelocity.set(
      (Math.random() - 0.5) * ROLL_ANGULAR,
      (Math.random() - 0.5) * ROLL_ANGULAR,
      (Math.random() - 0.5) * ROLL_ANGULAR,
    );
    phys.body.velocity.set(
      (Math.random() - 0.5) * ROLL_LINEAR,
      ROLL_TOSS,
      (Math.random() - 0.5) * ROLL_LINEAR,
    );
  }

  setValue(value: number): void {
    const transform = this.entity.getComponent(TransformComponent);
    const phys      = this.entity.getComponent(PhysicsComponent);
    const valueComp = this.entity.getComponent(ValueComponent);
    if (!transform || !phys?.body || !valueComp) return;

    const [qx, qy, qz, qw] = orientationForValue(value, this.state.faceMap);
    transform.setState({
      position: transform.state.position,
      rotation: [qx, qy, qz, qw],
      scale:    transform.state.scale,
    });
    const [px, py, pz] = transform.state.position;
    phys.body.position.set(px, py, pz);
    phys.body.quaternion.set(qx, qy, qz, qw);
    phys.body.velocity.setZero();
    phys.body.angularVelocity.setZero();
    valueComp.setState({ value: String(value), isNumeric: true });
  }

  private handleStopMoving(): void {
    const phys      = this.entity.getComponent(PhysicsComponent);
    const valueComp = this.entity.getComponent(ValueComponent);
    if (!phys?.body || !valueComp) return;
    const q = phys.body.quaternion;
    const face = resolveFaceFromOrientation(q.x, q.y, q.z, q.w, this.state.faceMap);
    const next = String(face);
    if (valueComp.state.value !== next) {
      valueComp.setState({ value: next, isNumeric: true });
    }
  }
}
