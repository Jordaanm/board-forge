// Stores a sortable / displayable value for an entity (dice face, counter, …).
// Slice #3 of issues--scene-graph.md. No view artefact, no dependencies.
//
// Issue #5 of issues--scripting-v1.md: setState dispatches `value-changed`
// on the owning entity whenever the resolved `value` differs from the
// previous value. Setting `value` to its current value is silent. Both the
// host setState path and the guest applyRemoteState path emit so scripts
// see the event regardless of which peer authored the change.

import { EntityComponent } from '../EntityComponent';

export interface ValueState {
  value:     string;
  isNumeric: boolean;
}

export interface ValueChangedPayload {
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

  setState(patch: Partial<ValueState>): void {
    const prevValue = this.state?.value;
    super.setState(patch);
    if (patch.value !== undefined && patch.value !== prevValue) {
      this.entity.dispatchEvent<ValueChangedPayload>('value-changed', {
        value:     this.state.value,
        isNumeric: this.state.isNumeric,
      });
    }
  }

  applyRemoteState(patch: Partial<ValueState>): void {
    const prevValue = this.state?.value;
    super.applyRemoteState(patch);
    if (patch.value !== undefined && patch.value !== prevValue) {
      this.entity.dispatchEvent<ValueChangedPayload>('value-changed', {
        value:     this.state.value,
        isNumeric: this.state.isNumeric,
      });
    }
  }
}
