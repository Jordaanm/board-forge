// Pure UV math for spritesheets. Convention:
//   - Cells are addressed by a single 0-based `index` in row-major order
//     (index 0 = top-left, index 1 = next cell to the right, wrapping after
//     `cols` cells to the next row down).
//   - THREE textures have origin at the bottom-left and `flipY = true` by
//     default — `TextureLoader` flips the image on upload so UV (0,0) maps
//     to the *top-left* of the original image. Row 0 (top of the sheet)
//     therefore corresponds to offsetY = 1 - rowHeight, not 0.
//   - Returned `offsetX`/`offsetY` are the texture.offset values; `repeatX`/
//     `repeatY` are the texture.repeat values (1/cols, 1/rows).
//
// Inputs are assumed validated by Manifest (cols/rows are positive integers).
// `index` outside [0, cols*rows) is clamped to 0 here — callers (AssetService)
// are responsible for surfacing out-of-bounds refs as `broken` *before*
// computing UVs.

export interface SpriteUV {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

export function spriteUV(index: number, cols: number, rows: number): SpriteUV {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const repeatX = 1 / cols;
  const repeatY = 1 / rows;
  return {
    offsetX: col * repeatX,
    offsetY: 1 - (row + 1) * repeatY,
    repeatX,
    repeatY,
  };
}
