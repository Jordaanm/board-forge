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
import { RichElement } from '../entity/components/RichElement';
import { ImageElement, type ImageFit } from '../entity/components/ImageElement';
import { ShapeElement, type ShapeKind } from '../entity/components/ShapeElement';
import { type ScriptErrorLog } from './ScriptErrorLog';

export interface ReadOnlyComponentView {
  readonly state: Readonly<Record<string, unknown>>;
}

// Lifetime context for a single Run. ScriptHost constructs one per Run and
// hands it down through SceneFacade → EntityFacade so addEventListener
// registrations get tracked centrally for teardown on the next Run.
export interface ScriptRunContext {
  // Each addEventListener call appends one record so teardown can iterate
  // and call removeListener against the underlying bus. Cleared after
  // teardown. The recorded `cb` is the wrapped callback (so removal
  // matches what was actually attached to the bus); `userCb` is the
  // original passed by the script so `removeEventListener(name, cb)` can
  // identify the right entry.
  registrations: Array<{ entity: Entity; event: string; userCb: Listener; cb: Listener }>;
  // Optional error sink — when present, listener exceptions funnel here
  // (issue #7 of issues--scripting-v1.md). Tests that don't care can omit.
  errorLog?:     ScriptErrorLog;
  // Optional console hook for listener exceptions; defaults to the global
  // console. Letting tests inject this keeps assertions deterministic.
  console?:      Pick<Console, 'error'>;
  // Host-only sound playback hook routed by World.broadcastPlaySound. When
  // absent (e.g. guest-side scripting if it ever exists, or unit tests),
  // SceneFacade.playSound no-ops with a sandbox warning.
  playSound?:    (slug: string) => void;
  // Optional sandbox-warning sink — defaults to console.warn. Tests inject
  // a recording function so guest-side / unknown-slug warnings are
  // deterministically observable.
  warn?:         (message: string) => void;
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
  //
  // The user's callback is wrapped so a thrown exception funnels into the
  // run-context's error log (issue #7) and `console.error`, then is
  // swallowed — preserving the bus's "one bad listener doesn't abort the
  // others" contract from #5.
  addEventListener(event: string, cb: Listener): void {
    const wrapped: Listener = (payload) => {
      try {
        cb(payload);
      } catch (e) {
        const consoleSink = this.ctx.console ?? console;
        consoleSink.error(`[script] listener for ${event} threw:`, e);
        this.ctx.errorLog?.push(`event:${event}`, e);
      }
    };
    this.entity_.addEventListener(event, wrapped);
    this.ctx.registrations.push({ entity: this.entity_, event, userCb: cb, cb: wrapped });
  }

  // Removes only the targeted callback. Looks up the wrapped function by
  // matching the original user callback, then detaches that wrapped one
  // from the bus and drops the registration entry.
  removeEventListener(event: string, cb: Listener): void {
    const idx = this.ctx.registrations.findIndex(
      r => r.entity === this.entity_ && r.event === event && r.userCb === cb,
    );
    if (idx < 0) return;
    const r = this.ctx.registrations[idx];
    this.entity_.removeEventListener(event, r.cb);
    this.ctx.registrations.splice(idx, 1);
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

  // Element-component mutators (issue #9 of issues--ui-surface.md). Each
  // routes to whichever element component this entity carries; calls on
  // entities without the relevant component no-op + warn so a typo in a
  // script surfaces audibly rather than silently mis-targeting.

  setHtml(html: string): void {
    const comp = this.entity_.getComponent(RichElement);
    if (!comp) { this.warn('setHtml: entity has no rich-element component'); return; }
    comp.setState({ html });
  }

  setImageRef(ref: string): void {
    const comp = this.entity_.getComponent(ImageElement);
    if (!comp) { this.warn('setImageRef: entity has no image-element component'); return; }
    comp.setState({ textureRef: ref });
  }

  setShape(opts: {
    kind?:        ShapeKind;
    fill?:        string;
    stroke?:      string;
    strokeWidth?: number;
    radius?:      number;
  }): void {
    const comp = this.entity_.getComponent(ShapeElement);
    if (!comp) { this.warn('setShape: entity has no shape-element component'); return; }
    comp.setState(opts);
  }

  setBounds(x: number, y: number, w: number, h: number): void {
    const target = this.entity_.getComponent(RichElement)
                ?? this.entity_.getComponent(ImageElement)
                ?? this.entity_.getComponent(ShapeElement);
    if (!target) { this.warn('setBounds: entity has no element component'); return; }
    target.setState({ x, y, w, h });
  }

  private warn(message: string): void {
    const sink = this.ctx.warn ?? ((m: string) => { if (typeof console !== 'undefined') console.warn('[script]', m); });
    sink(message);
  }
}
