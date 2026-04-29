// Stores a sortable / displayable value for an entity (dice face, counter, …).
// Slice #3 of issues--scene-graph.md. No view artefact, no dependencies.

import { EntityComponent } from '../EntityComponent';

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
}
