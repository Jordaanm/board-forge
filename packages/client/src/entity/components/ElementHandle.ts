// ElementHandle is the script-facing wrapper around a single entry in a
// SurfaceComponent's elements array (issue #2 of issues--ui-surface-refactor.
// md). Replaces the EntityFacade element-mutator surface (`setHtml`,
// `setBounds`, `setImageRef`, `setShape`) — those went away with the per-
// element entity model.
//
// A handle is just `{ surfaceId, elementId }` plus a back-reference to the
// scene. Every method re-resolves the element on each call, so a stale
// handle (the element id was removed from the array) silently no-ops on
// every method. Wrong-kind mutator calls warn + no-op so a typo surfaces
// audibly rather than silently mis-targeting a different element.
//
// `addEventListener` registers against the surface's per-element event bus
// (owned by SurfaceComponent). When called from a SceneFacade context the
// registration is also tracked on the active Run's ScriptRunContext so the
// next Run's teardown removes it. Constructed without a context the handle
// still works but lacks Run-scoped cleanup — used by direct test/editor
// callers.

import { type EntityScene } from '../EntityComponent';
import { type ScriptRunContext } from '../../scripting/EntityFacade';
import type { Listener } from '../EntityEventBus';
import { SurfaceComponent } from './SurfaceComponent';
import {
  type ImageFit,
  type ShapeShape,
  type ShapeElement,
  type ImageElement,
  type RichElement,
} from './SurfaceElement';

export interface ShapeMutationOpts {
  shape?:       ShapeShape;
  fill?:        string;
  stroke?:      string;
  strokeWidth?: number;
  radius?:      number;
}

export interface ElementHandleSurfaceLookup {
  // Returns the SurfaceComponent on the entity at `surfaceId`, or null when
  // the entity is gone or has no surface. ElementHandle re-resolves on every
  // call so a despawned surface naturally turns the handle into a no-op.
  surfaceById(surfaceId: string): SurfaceComponent | null;
}

export class ElementHandle {
  readonly surfaceId: string;
  readonly elementId: string;
  private readonly scene: ElementHandleSurfaceLookup;
  private readonly ctx:   ScriptRunContext | null;

  constructor(
    surfaceId: string,
    elementId: string,
    scene: ElementHandleSurfaceLookup,
    ctx: ScriptRunContext | null = null,
  ) {
    this.surfaceId = surfaceId;
    this.elementId = elementId;
    this.scene     = scene;
    this.ctx       = ctx;
  }

  // ── Mutators ────────────────────────────────────────────────────────────

  setBounds(x: number, y: number, w: number, h: number): void {
    const surface = this.surface();
    if (!surface) return;
    if (!surface.getElement(this.elementId)) return;  // stale id → silent
    surface.mutateElement(this.elementId, { x, y, w, h });
  }

  setHtml(html: string): void {
    const surface = this.surface();
    if (!surface) return;
    const el = surface.getElement(this.elementId);
    if (!el) return;
    if (el.kind !== 'rich') {
      this.warn(`setHtml: element is kind '${el.kind}', not 'rich' — ignored`);
      return;
    }
    surface.mutateElement<RichElement>(this.elementId, { html });
  }

  setImageRef(ref: string): void {
    const surface = this.surface();
    if (!surface) return;
    const el = surface.getElement(this.elementId);
    if (!el) return;
    if (el.kind !== 'image') {
      this.warn(`setImageRef: element is kind '${el.kind}', not 'image' — ignored`);
      return;
    }
    surface.mutateElement<ImageElement>(this.elementId, { textureRef: ref });
  }

  // Allow the caller to additionally tweak `fit` so scripts have one entry
  // point for image styling. Bounds change separately via `setBounds`.
  setImageFit(fit: ImageFit): void {
    const surface = this.surface();
    if (!surface) return;
    const el = surface.getElement(this.elementId);
    if (!el) return;
    if (el.kind !== 'image') {
      this.warn(`setImageFit: element is kind '${el.kind}', not 'image' — ignored`);
      return;
    }
    surface.mutateElement<ImageElement>(this.elementId, { fit });
  }

  setShape(opts: ShapeMutationOpts): void {
    const surface = this.surface();
    if (!surface) return;
    const el = surface.getElement(this.elementId);
    if (!el) return;
    if (el.kind !== 'shape') {
      this.warn(`setShape: element is kind '${el.kind}', not 'shape' — ignored`);
      return;
    }
    surface.mutateElement<ShapeElement>(this.elementId, opts);
  }

  // ── Listeners ───────────────────────────────────────────────────────────

  addEventListener(event: string, cb: Listener): void {
    const surface = this.surface();
    if (!surface) return;
    if (!surface.getElement(this.elementId)) return;  // stale → no-op

    const wrapped: Listener = (payload) => {
      try {
        cb(payload);
      } catch (e) {
        const consoleSink = this.ctx?.console ?? console;
        consoleSink.error(`[script] listener for ${event} threw:`, e);
        this.ctx?.errorLog?.push(`event:${event}`, e);
      }
    };
    surface.addElementListener(this.elementId, event, wrapped);

    if (this.ctx) {
      this.ctx.registrations.push({
        event,
        userCb:  cb,
        dispose: () => surface.removeElementListener(this.elementId, event, wrapped),
        elementId: this.elementId,
        surfaceId: this.surfaceId,
      });
    }
  }

  removeEventListener(event: string, cb: Listener): void {
    if (!this.ctx) return;
    const idx = this.ctx.registrations.findIndex(
      (r) =>
        r.surfaceId === this.surfaceId &&
        r.elementId === this.elementId &&
        r.event === event &&
        r.userCb === cb,
    );
    if (idx < 0) return;
    const r = this.ctx.registrations[idx];
    r.dispose();
    this.ctx.registrations.splice(idx, 1);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private surface(): SurfaceComponent | null {
    return this.scene.surfaceById(this.surfaceId);
  }

  private warn(message: string): void {
    const sink = this.ctx?.warn ?? ((m: string) => { if (typeof console !== 'undefined') console.warn('[ElementHandle]', m); });
    sink(message);
  }
}

// Convenience adapter — most callers carry a raw `EntityScene`. Wraps it as
// the lookup interface ElementHandle expects without anyone having to know
// the SurfaceComponent typeId string.
export function entitySceneLookup(scene: EntityScene): ElementHandleSurfaceLookup {
  return {
    surfaceById(surfaceId: string): SurfaceComponent | null {
      const e = scene.getEntity(surfaceId);
      if (!e) return null;
      return e.getComponent(SurfaceComponent) ?? null;
    },
  };
}
