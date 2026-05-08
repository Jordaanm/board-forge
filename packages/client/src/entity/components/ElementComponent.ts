// Abstract base for surface element components (issue #2 of
// issues--ui-surface.md). Element entities are children of a surface entity;
// they own no TransformComponent — their layout is 2D pixel bounds in the
// parent surface's canvas space. State must include `{ x, y, w, h }`.
//
// Subclasses implement `produceBitmap()`. Any `setState`, `onSpawn`, or
// `onDespawn` flips the parent surface's dirty flag through
// `surfaceRenderQueue`.

import { EntityComponent, type SpawnContext } from '../EntityComponent';

export interface ElementBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Duck-type for SurfaceComponent — avoids a static import cycle between
// SurfaceComponent ↔ ElementComponent.
interface SurfaceLike {
  markDirty(): void;
}

export abstract class ElementComponent<TState extends ElementBounds> extends EntityComponent<TState> {
  // Subclasses produce a bitmap representing the element at its current
  // (w, h). Returning null is allowed when no canvas backend is available
  // (test envs) or when content is not yet resolved (async asset load).
  abstract produceBitmap(): HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null;

  onSpawn(_ctx: SpawnContext): void {
    this.markParentSurfaceDirty();
  }

  onDespawn(_ctx: SpawnContext): void {
    this.markParentSurfaceDirty();
  }

  onPropertiesChanged(_changed: Partial<TState>): void {
    this.markParentSurfaceDirty();
  }

  getBounds(): ElementBounds {
    return { x: this.state.x, y: this.state.y, w: this.state.w, h: this.state.h };
  }

  protected markParentSurfaceDirty(): void {
    const parent = this.findParentEntity();
    if (!parent) return;
    const surface = parent.components.get('surface') as unknown as SurfaceLike | undefined;
    if (surface && typeof surface.markDirty === 'function') surface.markDirty();
  }

  private findParentEntity() {
    const e = this.entity;
    if (!e) return null;
    const parentId = e.parentId;
    if (!parentId) return null;
    const scene = e.scene;
    if (!scene) return null;
    return scene.getEntity(parentId);
  }
}
