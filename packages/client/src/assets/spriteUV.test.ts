import { describe, test, expect } from 'vitest';
import { spriteUV } from './spriteUV';

describe('spriteUV', () => {
  test('1x1 degenerate grid', () => {
    expect(spriteUV(0, 1, 1)).toEqual({ offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 });
  });

  test('square grid corners', () => {
    // 2x2: indices 0 (TL), 1 (TR), 2 (BL), 3 (BR)
    expect(spriteUV(0, 2, 2)).toEqual({ offsetX: 0,   offsetY: 0.5, repeatX: 0.5, repeatY: 0.5 });
    expect(spriteUV(1, 2, 2)).toEqual({ offsetX: 0.5, offsetY: 0.5, repeatX: 0.5, repeatY: 0.5 });
    expect(spriteUV(2, 2, 2)).toEqual({ offsetX: 0,   offsetY: 0,   repeatX: 0.5, repeatY: 0.5 });
    expect(spriteUV(3, 2, 2)).toEqual({ offsetX: 0.5, offsetY: 0,   repeatX: 0.5, repeatY: 0.5 });
  });

  test('non-square grid (13x4) corners', () => {
    const cols = 13, rows = 4;
    // index 0: top-left
    const tl = spriteUV(0, cols, rows);
    expect(tl.offsetX).toBeCloseTo(0);
    expect(tl.offsetY).toBeCloseTo(1 - 1 / rows);
    expect(tl.repeatX).toBeCloseTo(1 / cols);
    expect(tl.repeatY).toBeCloseTo(1 / rows);

    // index cols-1: top-right
    const tr = spriteUV(cols - 1, cols, rows);
    expect(tr.offsetX).toBeCloseTo((cols - 1) / cols);
    expect(tr.offsetY).toBeCloseTo(1 - 1 / rows);

    // index cols*(rows-1): bottom-left
    const bl = spriteUV(cols * (rows - 1), cols, rows);
    expect(bl.offsetX).toBeCloseTo(0);
    expect(bl.offsetY).toBeCloseTo(0);

    // index cols*rows - 1: bottom-right
    const br = spriteUV(cols * rows - 1, cols, rows);
    expect(br.offsetX).toBeCloseTo((cols - 1) / cols);
    expect(br.offsetY).toBeCloseTo(0);
  });

  test('row-major ordering: index increments column first', () => {
    const cols = 4, rows = 3;
    const a = spriteUV(0, cols, rows);
    const b = spriteUV(1, cols, rows);
    expect(b.offsetX).toBeCloseTo(a.offsetX + a.repeatX);
    expect(b.offsetY).toBeCloseTo(a.offsetY);

    // wrap to next row
    const c = spriteUV(cols, cols, rows);
    expect(c.offsetX).toBeCloseTo(0);
    expect(c.offsetY).toBeCloseTo(a.offsetY - a.repeatY);
  });

  test('repeat is constant across indices', () => {
    const cols = 8, rows = 7;
    for (let i = 0; i < cols * rows; i++) {
      const uv = spriteUV(i, cols, rows);
      expect(uv.repeatX).toBeCloseTo(1 / cols);
      expect(uv.repeatY).toBeCloseTo(1 / rows);
    }
  });
});
