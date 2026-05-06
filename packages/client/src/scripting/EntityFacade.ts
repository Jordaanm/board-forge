// Read-mostly wrapper around `Entity` exposed to user scripts via SceneFacade.
// One instance per (Run, Entity) — fresh each Run so per-Run state (listener
// registrations) lives on the wrapper and is torn down at the start of the
// next Run.
//
// Field access (`id`, `type`, `name`, `tags`) returns shallow copies of any
// arrays/objects so the script can't mutate the underlying entity by holding
// references. `getComponent(typeId)` returns a frozen view of the component's
// `state` only — no methods, no mutation surface (mutators land per-component
// as the API grows: `setValue` here, `setData` etc. in #6).

import { type Entity } from '../entity/Entity';
import { type Listener } from '../entity/EntityEventBus';
import { type SeatIndex } from '../seats/SeatLayout';
import { ValueComponent } from '../entity/components/ValueComponent';

export interface ReadOnlyComponentView {
  readonly state: Readonly<Record<string, unknown>>;
}

// Lifetime context for a single Run. ScriptHost constructs one per Run and
// hands it down through SceneFacade → EntityFacade so addEventListener
// registrations get tracked centrally for teardown on the next Run.
export interface ScriptRunContext {
  // Each addEventListener call appends one record so teardown can iterate
  // and call removeListener against the underlying bus. Cleared after
  // teardown.
  registrations: Array<{ entity: Entity; event: string; cb: Listener }>;
}

export class EntityFacade {
  private readonly entity_: Entity;
  private readonly ctx:     ScriptRunContext;

  constructor(entity: Entity, ctx: ScriptRunContext) {
    this.entity_ = entity;
    this.ctx     = ctx;
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

  // Subscribe to a domain event on this entity. The registration is tracked
  // on the active Run so the next Run's teardown removes it; scripts must
  // not assume listeners survive a re-Run.
  addEventListener(event: string, cb: Listener): void {
    this.entity_.addEventListener(event, cb);
    this.ctx.registrations.push({ entity: this.entity_, event, cb });
  }

  // Removes only the targeted callback. Also drops the matching entry from
  // the per-Run registry so teardown doesn't re-call removeListener for a
  // stale registration.
  removeEventListener(event: string, cb: Listener): void {
    this.entity_.removeEventListener(event, cb);
    const idx = this.ctx.registrations.findIndex(
      r => r.entity === this.entity_ && r.event === event && r.cb === cb,
    );
    if (idx >= 0) this.ctx.registrations.splice(idx, 1);
  }

  // Mutator — routes through ValueComponent.setState which dispatches
  // `value-changed` on change and replicates via the host's replicator.
  // No-op if the entity has no ValueComponent.
  setValue(value: string): void {
    const comp = this.entity_.getComponent(ValueComponent);
    if (!comp) return;
    const isNumeric = value.trim() !== '' && Number.isFinite(Number(value));
    comp.setState({ value, isNumeric });
  }

  // Per-entity persistent string map for cross-Run state. Mutations are
  // immediately visible on the host and replicate to guests as a full-map
  // entity-patch (issue #6 of issues--scripting-v1.md).
  setData(key: string, value: string): void {
    this.entity_.setCustomData(key, value);
  }

  getData(key: string): string | undefined {
    return this.entity_.getCustomData(key);
  }

  deleteData(key: string): boolean {
    return this.entity_.deleteCustomData(key);
  }
}
