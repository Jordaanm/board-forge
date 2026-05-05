// Thumbnail capture utility for save files and undo entries (PRD § Save / Load).
//
// Resamples the live canvas through an offscreen 2D context to the target
// size and returns a lossless PNG data URL. PNG is a prerequisite for the
// future steganography path that hides the save JSON inside the thumbnail
// pixels — JPEG's lossy reconstruction would corrupt embedded payloads.
// Switching to a dedicated `WebGLRenderTarget` is an optimisation left for
// later — the live-canvas approach captures whatever the user currently
// sees, which is exactly what a thumbnail should depict.

export interface ThumbnailOptions {
  width:  number;   // target width in pixels
  height: number;   // target height in pixels
}

export function captureCanvasThumbnail(
  source: HTMLCanvasElement,
  opts:   ThumbnailOptions,
): string {
  const off = document.createElement('canvas');
  off.width  = opts.width;
  off.height = opts.height;
  const ctx = off.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');
  ctx.drawImage(source, 0, 0, opts.width, opts.height);
  return off.toDataURL('image/png');
}
