// Canvas-on-plane surface (issue #2 of issues--ui-surface.md).
//
// SurfaceComponent owns an offscreen `<canvas>` and a THREE.CanvasTexture.
// On spawn it walks the parent MeshComponent's group and binds the texture
// directly onto each `default`-slot material's `map`, marking those
// materials with `userData.surfaceOwned = true` so MeshComponent's
// applyMaterialAttributes flow does not overwrite or unsub them.
//
// Composition is driven by SurfaceRenderQueue: any setState on a child
// element flips this surface's dirty bit, the queue collects flips per
// frame, then drains by calling compose() once. Re-flips that occur while
// compose() is running are queued for the next drain — collapses 60 Hz
// tween-driven mutations on the same element to one composition per frame.
//
// Element entities are children of the surface entity. compose() walks
// `entity.children` in order, asks each child's element component for a
// bitmap, and blits at the element's declared (x, y) bounds. Elements have
// no TransformComponent — their layout is purely 2D in canvas pixels.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext, type ReplicationChannel } from '../EntityComponent';
import { MeshComponent } from './MeshComponent';
import { surfaceRenderQueue } from './SurfaceRenderQueue';
import type { ElementComponent, ElementBounds } from './ElementComponent';
import type { InputEventPayload } from '../../input/inputEvents';
import type { Entity } from '../Entity';

export interface SurfaceState {
  canvasSize: [number, number];
}

export class SurfaceComponent extends EntityComponent<SurfaceState> {
  static typeId:   string                = 'surface';
  static requires: readonly string[]     = ['mesh'];
  static channel:  ReplicationChannel    = 'reliable';

  canvas:  HTMLCanvasElement | null   = null;
  texture: THREE.CanvasTexture | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  onSpawn(_ctx: SpawnContext): void {
    if (!this.state) this.state = { canvasSize: [512, 512] };
    if (typeof document === 'undefined') return;

    const [w, h] = this.state.canvasSize;
    this.canvas = document.createElement('canvas');
    this.canvas.width  = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.bindToMesh();
    this.markDirty();
  }

  onDespawn(_ctx: SpawnContext): void {
    this.unbindFromMesh();
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
      this.markDirty();
    }
  }

  markDirty(): void {
    surfaceRenderQueue.markDirty(this);
  }

  // Press / released / click forwarding (issue #4 of issues--ui-surface.md).
  // The dispatcher fires the event on the surface entity bus with
  // `payload.surfaceUV` populated from the THREE intersection. We resolve UV
  // → pixel, walk children in reverse z-order, and re-fire the same event
  // on the first element entity whose bounds contain the pixel. Re-fire is
  // local-only (does NOT route through World.fireInputEvent — element-level
  // dispatch is deterministic on every peer because element state is
  // replicated). Misses leave the event on the surface.
  onPress    (payload: InputEventPayload): void { this.forwardEvent('pressed',  payload); }
  onReleased (payload: InputEventPayload): void { this.forwardEvent('released', payload); }
  onClick    (payload: InputEventPayload): void { this.forwardEvent('click',    payload); }

  private forwardEvent(name: 'pressed' | 'released' | 'click', payload: InputEventPayload): Entity | null {
    const uv = payload.surfaceUV;
    if (!uv) return null;
    const hit = this.resolveElementAtUV(uv);
    if (!hit) return null;
    const extended: InputEventPayload = { ...payload, surfaceUV: { ...uv }, pixel: hit.pixel };
    hit.entity.dispatchEvent(name, extended);
    return hit.entity;
  }

  // Exposed so #5 (hover forwarding) can share the resolution path.
  resolveElementAtUV(uv: { u: number; v: number }): { entity: Entity; pixel: { x: number; y: number } } | null {
    const [w, h] = this.state.canvasSize;
    const pixel  = { x: uv.u * w, y: uv.v * h };
    const scene  = this.entity.scene;
    if (!scene) return null;
    const childIds = this.entity.children;
    for (let i = childIds.length - 1; i >= 0; i--) {
      const child = scene.getEntity(childIds[i]);
      if (!child) continue;
      const el = findElementComponent(child);
      if (!el) continue;
      const b = el.getBounds();
      if (pixel.x < b.x || pixel.x >= b.x + b.w) continue;
      if (pixel.y < b.y || pixel.y >= b.y + b.h) continue;
      return { entity: child, pixel };
    }
    return null;
  }

  // Drain entry point — invoked by SurfaceRenderQueue. Walks
  // `entity.children` in order, asks each child's element component for a
  // bitmap, and blits at the element's bounds. No-op when no canvas backend
  // is available (test envs without canvas/2d context).
  compose(): void {
    if (!this.canvas || !this.ctx) return;
    const ctx    = this.ctx;
    const [w, h] = this.state.canvasSize;
    ctx.clearRect(0, 0, w, h);

    const scene = this.entity.scene;
    if (!scene) return;
    for (const childId of this.entity.children) {
      const child = scene.getEntity(childId);
      if (!child) continue;
      const el = findElementComponent(child);
      if (!el) continue;
      const bitmap = el.produceBitmap();
      if (!bitmap) continue;
      const bounds = el.getBounds();
      if (bounds.w <= 0 || bounds.h <= 0) continue;
      ctx.drawImage(bitmap, bounds.x, bounds.y);
    }

    if (this.texture) this.texture.needsUpdate = true;
  }

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
        // Surface keeps the canvas content authoritative — render with white
        // base colour so tint never tints the composed bitmap.
        lambert.color?.set(0xffffff);
        mat.userData = { ...(mat.userData ?? {}), surfaceOwned: true };
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
        delete (mat.userData as Record<string, unknown>).surfaceOwned;
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

// Locate the first ElementComponent-shaped component on an entity. Children
// of a surface are expected to carry exactly one element component; the
// duck-type check (produceBitmap + getBounds) avoids hard-coding the typeId
// list and naturally accommodates future element types.
function findElementComponent(child: { components: Map<string, unknown> }): ElementComponent<ElementBounds> | null {
  for (const comp of child.components.values()) {
    const el = comp as Partial<ElementComponent<ElementBounds>>;
    if (typeof el.produceBitmap === 'function' && typeof el.getBounds === 'function') {
      return el as ElementComponent<ElementBounds>;
    }
  }
  return null;
}
