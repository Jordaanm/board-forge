// Process-singleton queue draining dirty SurfaceComponents once per scene
// update tick (issue #2 of issues--ui-surface.md). Surfaces register
// themselves through `markDirty` whenever a child element mutates; `drain`
// composes each registered surface once and clears its dirty flag.
//
// Idempotent against re-flips during drain: a surface that flips itself dirty
// while its compose() is running stays in the queue for the *next* drain, not
// the current one. This collapses tween-driven 60 Hz mutations on the same
// element to one composition per frame.

import type { SurfaceComponent } from './SurfaceComponent';

export class SurfaceRenderQueue {
  private dirty = new Set<SurfaceComponent>();

  markDirty(surface: SurfaceComponent): void {
    this.dirty.add(surface);
  }

  drain(): void {
    const current = this.dirty;
    this.dirty = new Set();
    for (const surface of current) {
      surface.compose();
    }
  }

  size(): number {
    return this.dirty.size;
  }

  clear(): void {
    this.dirty.clear();
  }
}

export const surfaceRenderQueue = new SurfaceRenderQueue();
