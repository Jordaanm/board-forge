// Read-only wrapper around `Entity` exposed to user scripts via SceneFacade.
// One instance per (Run, Entity) — fresh each Run so per-Run state (listener
// registrations once #5 lands) can be local to the wrapper.
//
// Field access (`id`, `type`, `name`, `tags`) returns shallow copies of any
// arrays/objects so the script can't mutate the underlying entity by holding
// references. `getComponent(typeId)` returns a frozen view of the component's
// `state` only — no methods, no mutation surface (those land in #5/#6).

import { type Entity } from '../entity/Entity';
import { type SeatIndex } from '../seats/SeatLayout';

export interface ReadOnlyComponentView {
  readonly state: Readonly<Record<string, unknown>>;
}

export class EntityFacade {
  // Held as a private back-reference so future slices can extend the facade
  // (setValue, customData, listeners) without exposing the raw Entity.
  private readonly entity_: Entity;

  constructor(entity: Entity) {
    this.entity_ = entity;
  }

  get id():    string                 { return this.entity_.id; }
  get type():  string                 { return this.entity_.type; }
  get name():  string                 { return this.entity_.name; }
  get owner(): SeatIndex | null       { return this.entity_.owner; }

  // Defensive copy — mutating the returned array does not affect the entity.
  get tags(): string[] {
    return [...this.entity_.tags];
  }

  // Returns a frozen view of the component's `state`. No methods, no setState.
  // Returns undefined if the entity has no component of the given type.
  getComponent(typeId: string): ReadOnlyComponentView | undefined {
    const comp = this.entity_.components.get(typeId);
    if (!comp) return undefined;
    return Object.freeze({
      state: Object.freeze({ ...(comp.state as object) }) as Readonly<Record<string, unknown>>,
    });
  }
}
