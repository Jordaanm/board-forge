// Plays AudioBuffer assets through a shared AudioContext. Issue #11 of
// issues--asset-registry.md.
//
// `playSlug(slug)` resolves the slug through `AssetService.subscribe(... 'sound' ...)`
// — that gets back the cached buffer if already loaded, or kicks off a fetch
// otherwise. Once the buffer is available (and only on the `loaded` status),
// a fresh `AudioBufferSourceNode` is created and `start(0)`-ed. Each playback
// owns its own source node; we never reuse one (Web Audio nodes are
// single-use).

import { type AssetService } from './AssetService';

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  constructor(private assets: AssetService) {}

  playSlug(slug: string): void {
    const ctx = this.getContext();
    if (!ctx) return;
    // Most browsers start AudioContexts in a 'suspended' state until a user
    // gesture; resume is a no-op once it's already running and otherwise
    // returns a promise we intentionally don't await — the next playback
    // attempt after the gesture lands will succeed.
    if (ctx.state === 'suspended') void ctx.resume();

    let played = false;
    const unsub = this.assets.subscribe(slug, 'sound', (buf, status) => {
      if (played) return;
      if (status === 'loaded' && buf) {
        played = true;
        try {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        } catch {
          // The browser may revoke or refuse the underlying AudioContext;
          // failing silently keeps a single bad sound from breaking gameplay.
        }
        // Defer unsubscribe — calling unsub from inside the listener would
        // mutate the listener Set during iteration in AssetService.
        queueMicrotask(unsub);
      } else if (status === 'broken') {
        played = true;
        queueMicrotask(unsub);
      }
    });
  }

  private getContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof AudioContext !== 'undefined'
      ? AudioContext
      : (typeof window !== 'undefined'
          && (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        || null;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }
}
