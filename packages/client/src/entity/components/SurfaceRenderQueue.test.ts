import { describe, test, expect } from 'vitest';
import { SurfaceRenderQueue } from './SurfaceRenderQueue';
import type { SurfaceComponent } from './SurfaceComponent';

function fakeSurface(name: string, onCompose?: (s: any) => void): SurfaceComponent {
  const surface = {
    name,
    composed: 0,
    compose() {
      this.composed++;
      onCompose?.(this);
    },
  };
  return surface as unknown as SurfaceComponent;
}

describe('SurfaceRenderQueue', () => {
  test('drain composes each registered surface once and clears the queue', () => {
    const q = new SurfaceRenderQueue();
    const a = fakeSurface('a');
    const b = fakeSurface('b');
    q.markDirty(a);
    q.markDirty(b);
    expect(q.size()).toBe(2);

    q.drain();
    expect(q.size()).toBe(0);
    expect((a as any).composed).toBe(1);
    expect((b as any).composed).toBe(1);
  });

  test('repeated markDirty before drain coalesces — surface composes once', () => {
    const q = new SurfaceRenderQueue();
    const a = fakeSurface('a');
    for (let i = 0; i < 100; i++) q.markDirty(a);
    q.drain();
    expect((a as any).composed).toBe(1);
  });

  test('re-flipping during drain re-enqueues for next frame, not the current', () => {
    const q = new SurfaceRenderQueue();
    let composedThisDrain = 0;
    const a = fakeSurface('a', (self) => {
      composedThisDrain++;
      // Surface flips itself dirty during compose() — must NOT re-run this drain.
      if ((self as any).composed === 1) q.markDirty(self);
    });
    q.markDirty(a);
    q.drain();
    expect(composedThisDrain).toBe(1);
    expect(q.size()).toBe(1); // re-flip carried into next drain

    q.drain();
    expect((a as any).composed).toBe(2);
    expect(q.size()).toBe(0);
  });

  test('drain on empty queue is a no-op', () => {
    const q = new SurfaceRenderQueue();
    expect(() => q.drain()).not.toThrow();
    expect(q.size()).toBe(0);
  });
});
