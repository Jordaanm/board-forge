// Stores a sortable / displayable value for an entity (dice face, counter, …).
// Slice #3 of issues--scene-graph.md. No view artefact, no dependencies.

import { EntityComponent, type MenuContext, type MenuItem, type ActionContext } from '../EntityComponent';
import { PhysicsComponent } from './PhysicsComponent';

export interface ValueState {
  value:     string;
  isNumeric: boolean;
}

export class ValueComponent extends EntityComponent<ValueState> {
  static typeId = 'value';

  onSpawn(): void { /* no view */ }
  onPropertiesChanged(): void { /* no view */ }

  asNumber(): number | null {
    if (!this.state.isNumeric) return null;
    const n = Number(this.state.value);
    return Number.isFinite(n) ? n : null;
  }

  // Roll is exposed for any value-bearing entity that also has a body —
  // physics produces the new face when it settles. Available to seated guests
  // (host runs the impulse via the invoke-action round-trip).
  onContextMenu(ctx: MenuContext): MenuItem[] {
    if (!ctx.entity.getComponent(PhysicsComponent)) return [];
    return [{ kind: 'action', id: 'roll', label: 'Roll' }];
  }

  onAction(actionId: string, _args: object | undefined, ctx: ActionContext): void {
    if (actionId !== 'roll') return;
    const phys = ctx.entity.getComponent(PhysicsComponent);
    if (!phys?.body) return;
    phys.body.wakeUp();
    phys.body.angularVelocity.set(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40,
    );
    phys.body.velocity.set(
      (Math.random() - 0.5) * 4,
      3,
      (Math.random() - 0.5) * 4,
    );
  }
}
