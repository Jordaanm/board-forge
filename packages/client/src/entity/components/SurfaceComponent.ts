// Canvas-on-plane surface (issue #2 of issues--ui-surface.md, refactored
// for issue #2 of issues--ui-surface-refactor.md).
//
// SurfaceComponent owns:
//   - an offscreen `<canvas>` + THREE.CanvasTexture bound to the parent
//     entity's MeshComponent material map;
//   - an `elements: SurfaceElement[]` array on `state` — the replicated
//     description of every surface element (shape / image / rich) — replacing
//     the old child-entity model;
//   - a `Map<elementId, ElementRuntime>` — per-element imperative runtime
//     (asset subs, async render state) keyed by id;
//   - a `Map<elementId, EntityEventBus>` — per-element event bus that
//     ElementHandle's `addEventListener` writes into.
//
// State apply (host-side `setState({ elements: ... })` or guest-side
// `applyRemoteState`) walks `onPropertiesChanged`, which diffs the new array
// against the live runtimes/buses and runs add → mount, remove → unmount,
// mutated same-`kind` → update, mutated different-`kind` → unmount + mount.
// Element-array replication is whole-array on the reliable channel — the
// receiver runs the same diff and lifecycle locally.
//
// Composition: any runtime call to `markDirty` (or any state change) flips
// this surface's dirty bit through `surfaceRenderQueue`. drain() calls
// compose(), which iterates `state.elements` in order, asks each id's runtime
// for a bitmap, and blits at the element's bounds.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext, type MenuContext, type ReplicationChannel, type ComponentClass } from '../EntityComponent';
import { MeshComponent } from './MeshComponent';
import { TransformComponent } from './TransformComponent';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import { EntityEventBus, type Listener } from '../EntityEventBus';
import {
  type SurfaceElement,
  type ShapeElement,
  type ImageElement,
  type RichElement,
  type EditorElementKind,
  newElementId,
  makeDefaultElement,
} from './SurfaceElement';
import {
  type ElementRuntime,
  makeRuntime,
} from './ElementRuntime';
import type { InputEventPayload } from '../../input/inputEvents';
import type { EditorToolItem } from '../editorTools';

export interface SurfaceState {
  canvasSize: [number, number];
  elements:   SurfaceElement[];
}

export class SurfaceComponent extends EntityComponent<SurfaceState> {
  static typeId:   string                = 'surface';
  static requires: readonly string[]     = ['mesh'];
  static channel:  ReplicationChannel    = 'reliable';

  canvas:  HTMLCanvasElement | null   = null;
  texture: THREE.CanvasTexture | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastHoveredElementId: string | null = null;

  // Per-element runtimes. Map order is irrelevant — render order comes from
  // `state.elements`. Buses are owned per-id so ElementHandle subscribers
  // survive same-id mutations and are torn down with the element.
  private runtimes: Map<string, ElementRuntime> = new Map();
  private buses:    Map<string, EntityEventBus> = new Map();
  // Last applied snapshot per id — needed to drive `runtime.update(prev,
  // next)` since `state.elements` has already been overwritten by the time
  // `onPropertiesChanged` runs.
  private snapshots: Map<string, SurfaceElement> = new Map();

  onSpawn(_ctx: SpawnContext): void {
    if (!this.state) this.state = { canvasSize: [512, 512], elements: [] };
    if (!this.state.elements) this.state.elements = [];
    this.attachToParentObject3D();

    if (typeof document !== 'undefined') {
      const [w, h] = this.state.canvasSize;
      this.canvas = document.createElement('canvas');
      this.canvas.width  = w;
      this.canvas.height = h;
      this.ctx = this.canvas.getContext('2d');

      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;

      this.bindToMesh();
    }

    // Mount any pre-loaded elements (the save/load path land elements onto
    // `state.elements` before onSpawn fires; spawn-time mount runs the same
    // lifecycle a runtime add would).
    this.diffAndApply();
    this.markDirty();
  }

  onDespawn(_ctx: SpawnContext): void {
    this.unbindFromMesh();
    this.detachFromParentObject3D();
    for (const r of this.runtimes.values()) r.unmount();
    this.runtimes.clear();
    this.buses.clear();
    this.snapshots.clear();
    this.texture?.dispose();
    this.texture = null;
    this.canvas  = null;
    this.ctx     = null;
  }

  onPropertiesChanged(changed: Partial<SurfaceState>): void {
    if (changed.canvasSize !== undefined && this.canvas) {
      const [w, h] = this.state.canvasSize;
      this.canvas.width  = w;
      this.canvas.height = h;
      if (this.texture) this.texture.needsUpdate = true;
    }
    if (changed.elements !== undefined) this.diffAndApply();
    this.markDirty();
  }

  // ── Element-array mutators (host-only paths) ────────────────────────────

  // Append a new element with default state for the requested editor kind.
  // Mutates the array in place, runs lifecycle locally, replicates the whole
  // array. Returns the new element's id.
  attachElement(kind: EditorElementKind): string {
    const [w, h] = this.state.canvasSize;
    const element = makeDefaultElement(kind, w, h);
    return this.addElement(element);
  }

  // Append an explicitly-built SurfaceElement (used by attachSticker so the
  // sticker's content shape is honoured directly). Returns the element id.
  addElement(element: SurfaceElement): string {
    this.state.elements = [...this.state.elements, element];
    this.diffAndApply();
    this.markDirty();
    this.replicateElements();
    return element.id;
  }

  // Delete an element by id. No-op if the id isn't in the array. Replicates.
  removeElement(id: string): void {
    const idx = this.state.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    this.state.elements = this.state.elements.filter((_, i) => i !== idx);
    this.diffAndApply();
    this.markDirty();
    this.replicateElements();
  }

  // Patch an element's data in place. Discriminator (`kind`) cannot be
  // changed by mutation — pass-through callers (ElementHandle.setHtml etc.)
  // already gate on kind. Replicates the whole array.
  mutateElement<T extends SurfaceElement>(id: string, patch: Partial<T>): void {
    const idx = this.state.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const prev = this.state.elements[idx];
    const next = { ...prev, ...patch, id: prev.id, kind: prev.kind } as SurfaceElement;
    this.state.elements = [
      ...this.state.elements.slice(0, idx),
      next,
      ...this.state.elements.slice(idx + 1),
    ];
    this.diffAndApply();
    this.markDirty();
    this.replicateElements();
  }

  // Element-id → element data lookup. Read-only — callers must use
  // mutateElement to change content. Returns null for unknown ids.
  getElement(id: string): SurfaceElement | null {
    return this.state.elements.find((e) => e.id === id) ?? null;
  }

  // ── Element event buses (per-id) ────────────────────────────────────────

  addElementListener(id: string, event: string, cb: Listener): void {
    const bus = this.busFor(id);
    if (!bus) return;
    bus.addListener(event, cb);
  }

  removeElementListener(id: string, event: string, cb: Listener): void {
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.removeListener(event, cb);
  }

  // ── Diff lifecycle ──────────────────────────────────────────────────────

  private diffAndApply(): void {
    const elements = this.state.elements ?? [];
    const liveIds  = new Set<string>();
    for (const el of elements) liveIds.add(el.id);

    // Drop runtimes / buses / snapshots whose ids vanished.
    for (const [id, runtime] of [...this.runtimes]) {
      if (!liveIds.has(id)) {
        runtime.unmount();
        this.runtimes.delete(id);
        this.buses.delete(id);
        this.snapshots.delete(id);
      }
    }

    // Mount/update for every element in the array, in order.
    for (const el of elements) {
      const existing = this.runtimes.get(el.id);
      const prev     = this.snapshots.get(el.id);
      if (!existing) {
        const fresh = makeRuntime(el, { markDirty: () => this.markDirty() });
        this.runtimes.set(el.id, fresh);
        this.buses.set(el.id, this.buses.get(el.id) ?? new EntityEventBus());
        fresh.mount(el);
        this.snapshots.set(el.id, el);
        continue;
      }
      if (!prev || prev.kind !== el.kind) {
        existing.unmount();
        const fresh = makeRuntime(el, { markDirty: () => this.markDirty() });
        this.runtimes.set(el.id, fresh);
        fresh.mount(el);
        this.snapshots.set(el.id, el);
        continue;
      }
      // Same kind — runtime.update on a typed element. The cast is safe
      // because prev.kind === el.kind narrows the union to a single variant.
      (existing as ElementRuntime<typeof el>).update(prev as typeof el, el);
      this.snapshots.set(el.id, el);
    }
  }

  private replicateElements(): void {
    if (!this.world || !this.entity) return;
    const ctor = this.constructor as ComponentClass;
    this.world.enqueueComponentPatch({
      entityId: this.entity.id,
      typeId:   ctor.typeId,
      partial:  { elements: this.state.elements } as Record<string, unknown>,
    });
  }

  private busFor(id: string): EntityEventBus | null {
    let bus = this.buses.get(id);
    if (bus) return bus;
    // Element id must be in the elements array — adding a listener for a
    // stale id is a silent no-op (the ElementHandle warning is the visible
    // path).
    if (!this.state.elements.some((e) => e.id === id)) return null;
    bus = new EntityEventBus();
    this.buses.set(id, bus);
    return bus;
  }

  markDirty(): void {
    surfaceRenderQueue.markDirty(this);
  }

  onEditorTools(_ctx: MenuContext): EditorToolItem[] {
    return [
      { kind: 'button', id: 'add-rich',         label: 'Add Rich UI'        },
      { kind: 'button', id: 'add-image',        label: 'Add Image'          },
      { kind: 'button', id: 'add-shape-rect',   label: 'Add Rectangle'      },
      { kind: 'button', id: 'add-shape-circle', label: 'Add Circle'         },
    ];
  }

  // ── Input forwarding ────────────────────────────────────────────────────

  onPress    (payload: InputEventPayload): void { this.forwardEvent('pressed',  payload); }
  onReleased (payload: InputEventPayload): void { this.forwardEvent('released', payload); }
  onClick    (payload: InputEventPayload): void { this.forwardEvent('click',    payload); }

  onHoverStart(payload: InputEventPayload): void {
    const uv = payload.surfaceUV;
    if (!uv) return;
    const hit = this.resolveElementAtUV(uv);
    if (!hit) return;
    this.lastHoveredElementId = hit.id;
    this.dispatchTo(hit.id, 'hover-start', { ...payload, surfaceUV: { ...uv }, pixel: hit.pixel });
  }

  onHoverMove(payload: InputEventPayload): void {
    const uv = payload.surfaceUV;
    if (!uv) return;
    const hit   = this.resolveElementAtUV(uv);
    const newId = hit?.id ?? null;
    if (newId === this.lastHoveredElementId) {
      if (hit) this.dispatchTo(hit.id, 'hover-move', { ...payload, surfaceUV: { ...uv }, pixel: hit.pixel });
      return;
    }
    if (this.lastHoveredElementId) {
      this.dispatchTo(this.lastHoveredElementId, 'hover-end', { ...payload, surfaceUV: { ...uv } });
    }
    this.lastHoveredElementId = newId;
    if (hit) this.dispatchTo(hit.id, 'hover-start', { ...payload, surfaceUV: { ...uv }, pixel: hit.pixel });
  }

  onHoverEnd(payload: InputEventPayload): void {
    if (this.lastHoveredElementId) {
      this.dispatchTo(this.lastHoveredElementId, 'hover-end', { ...payload });
    }
    this.lastHoveredElementId = null;
  }

  private forwardEvent(name: 'pressed' | 'released' | 'click', payload: InputEventPayload): string | null {
    const uv = payload.surfaceUV;
    if (!uv) return null;
    const hit = this.resolveElementAtUV(uv);
    if (!hit) return null;
    const extended: InputEventPayload = { ...payload, surfaceUV: { ...uv }, pixel: hit.pixel };
    this.dispatchTo(hit.id, name, extended);
    return hit.id;
  }

  private dispatchTo(id: string, name: string, payload: InputEventPayload): void {
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.dispatch(name, payload);
  }

  // Reverse z-order: later array entries draw on top, so they win the hit.
  resolveElementAtUV(uv: { u: number; v: number }): { id: string; pixel: { x: number; y: number } } | null {
    const [w, h] = this.state.canvasSize;
    const pixel  = { x: uv.u * w, y: uv.v * h };
    for (let i = this.state.elements.length - 1; i >= 0; i--) {
      const el = this.state.elements[i];
      if (pixel.x < el.x || pixel.x >= el.x + el.w) continue;
      if (pixel.y < el.y || pixel.y >= el.y + el.h) continue;
      return { id: el.id, pixel };
    }
    return null;
  }

  // Drain entry — invoked by SurfaceRenderQueue. Iterates `state.elements`
  // in order, asks each id's runtime for a bitmap, blits at the element
  // bounds. No-op when no canvas backend is available.
  compose(): void {
    if (!this.canvas || !this.ctx) return;
    const ctx    = this.ctx;
    const [w, h] = this.state.canvasSize;
    ctx.clearRect(0, 0, w, h);

    for (const el of this.state.elements) {
      const runtime = this.runtimes.get(el.id);
      if (!runtime) continue;
      const bitmap = runtime.produceBitmap();
      if (!bitmap) continue;
      if (el.w <= 0 || el.h <= 0) continue;
      ctx.drawImage(bitmap, el.x, el.y);
    }

    if (this.texture) this.texture.needsUpdate = true;
  }

  // ── THREE scene-graph plumbing (issue #1 of refactor) ───────────────────

  private attachToParentObject3D(): void {
    const parent = this.findParentObject3D();
    const self   = this.entity.getComponent(TransformComponent)?.object3d;
    if (!parent || !self) return;
    parent.add(self);
  }

  private detachFromParentObject3D(): void {
    const self = this.entity.getComponent(TransformComponent)?.object3d;
    if (!self) return;
    const parent = this.findParentObject3D();
    if (parent && self.parent === parent) parent.remove(self);
  }

  private findParentObject3D(): THREE.Object3D | null {
    const parentId = this.entity?.parentId;
    if (!parentId) return null;
    const scene = this.entity.scene;
    if (!scene) return null;
    const parentEntity = scene.getEntity(parentId);
    if (!parentEntity) return null;
    return parentEntity.getComponent(TransformComponent)?.object3d ?? null;
  }

  // ── Mesh material binding ───────────────────────────────────────────────

  private bindToMesh(): void {
    const tex = this.texture;
    if (!tex) return;
    const mesh = this.entity.getComponent(MeshComponent);
    if (!mesh) return;
    mesh.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const meshSlot = (child.userData.materialSlot as string | undefined) ?? 'default';
      const apply = (mat: THREE.Material) => {
        const lambert = mat as THREE.MeshLambertMaterial;
        lambert.map = tex;
        lambert.color?.set(0xffffff);
        const prevTransparent = mat.transparent;
        mat.transparent = true;
        mat.userData = { ...(mat.userData ?? {}), surfaceOwned: true, prevTransparent };
        lambert.needsUpdate = true;
      };
      if (Array.isArray(child.material)) {
        for (const mat of child.material) {
          const matSlot = (mat.userData?.materialSlot as string | undefined) ?? meshSlot;
          if (matSlot === 'default') apply(mat);
        }
      } else if (meshSlot === 'default') {
        apply(child.material);
      }
    });
  }

  private unbindFromMesh(): void {
    const mesh = this.entity?.getComponent(MeshComponent);
    if (!mesh || !mesh.group) return;
    mesh.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const apply = (mat: THREE.Material) => {
        if (!mat.userData?.surfaceOwned) return;
        const lambert = mat as THREE.MeshLambertMaterial;
        lambert.map = null;
        const ud = mat.userData as Record<string, unknown>;
        if ('prevTransparent' in ud) {
          mat.transparent = Boolean(ud.prevTransparent);
          delete ud.prevTransparent;
        }
        delete ud.surfaceOwned;
        lambert.needsUpdate = true;
      };
      if (Array.isArray(child.material)) {
        for (const mat of child.material) apply(mat);
      } else {
        apply(child.material);
      }
    });
  }
}

// Re-exports kept for callers that want the union shapes via a single import.
export {
  type SurfaceElement,
  type ShapeElement,
  type ImageElement,
  type RichElement,
  type EditorElementKind,
  newElementId,
};
