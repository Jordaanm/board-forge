// Thumbnail capture utility for save files and undo entries (PRD § Save / Load).
//
// First implementation just calls `canvas.toDataURL('image/jpeg', q)` on the
// live canvas and resamples through an offscreen 2D context to the target
// size. Switching to a dedicated `WebGLRenderTarget` is an optimisation left
// for later — the live-canvas approach captures whatever the user currently
// sees, which is exactly what a thumbnail should depict.

export interface ThumbnailOptions {
  width:   number;   // target width in pixels
  height:  number;   // target height in pixels
  quality?: number;  // JPEG quality 0..1, default 0.8
}

export function captureCanvasThumbnail(
  source: HTMLCanvasElement,
  opts:   ThumbnailOptions,
): string {
  const quality = opts.quality ?? 0.8;
  const off = document.createElement('canvas');
  off.width  = opts.width;
  off.height = opts.height;
  const ctx = off.getContext('2d');
  if (!ctx) return source.toDataURL('image/jpeg', quality);
  ctx.drawImage(source, 0, 0, opts.width, opts.height);
  return off.toDataURL('image/jpeg', quality);
}
