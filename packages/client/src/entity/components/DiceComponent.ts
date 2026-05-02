// Orchestrates dice behaviour by composing the sibling Transform / Physics /
// Value components. State is set once at spawn from the spawnable definition
// and never mutated — replicating it lets guests rebuild the face resolver.
// Slice 2 of issues--dice.md.

import {
  EntityComponent,
  type SpawnContext,
  type MenuContext,
  type MenuItem,
  type ActionContext,
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

  onContextMenu(_ctx: MenuContext): MenuItem[] {
    const value = this.entity.getComponent(ValueComponent)?.state.value ?? '?';
    return [
      { kind: 'action', id: 'roll',  label: 'Roll' },
      { kind: 'action', id: 'value', label: `Value: ${value}`, disabled: true },
    ];
  }

  onAction(actionId: string, _args: object | undefined, _ctx: ActionContext): void {
    if (actionId === 'roll') this.roll();
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
