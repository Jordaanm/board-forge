import { describe, test, expect } from 'vitest';
import {
  getSeatLayout,
  SEAT_COLOURS,
  type SeatIndex,
  type SeatPose,
  type TableShape,
} from './SeatLayout';

const ALL_INDICES: SeatIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];
const SHAPES: TableShape[]     = ['rectangle', 'circle'];

describe('SEAT_COLOURS', () => {
  test('has 8 entries in fixed order', () => {
    expect(SEAT_COLOURS).toEqual(
      ['white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'],
    );
  });
});

describe('getSeatLayout — rectangle', () => {
  // Table 12 × 8. CCW from front-right: 3 front (+Z), 1 left (-X), 3 back (-Z), 1 right (+X).
  const cases: Array<[SeatIndex, SeatPose]> = [
    [0, { position: { x:  3, y: 0, z:  4 }, facing: { x:  0, y: 0, z: -1 } }],
    [1, { position: { x:  0, y: 0, z:  4 }, facing: { x:  0, y: 0, z: -1 } }],
    [2, { position: { x: -3, y: 0, z:  4 }, facing: { x:  0, y: 0, z: -1 } }],
    [3, { position: { x: -6, y: 0, z:  0 }, facing: { x:  1, y: 0, z:  0 } }],
    [4, { position: { x: -3, y: 0, z: -4 }, facing: { x:  0, y: 0, z:  1 } }],
    [5, { position: { x:  0, y: 0, z: -4 }, facing: { x:  0, y: 0, z:  1 } }],
    [6, { position: { x:  3, y: 0, z: -4 }, facing: { x:  0, y: 0, z:  1 } }],
    [7, { position: { x:  6, y: 0, z:  0 }, facing: { x: -1, y: 0, z:  0 } }],
  ];

  test.each(cases)('seat %i', (i, expected) => {
    expect(getSeatLayout('rectangle', i)).toEqual(expected);
  });
});

describe('getSeatLayout — circle', () => {
  const R   = 4;                 // min(12, 8) / 2
  const s45 = Math.SQRT1_2;      // sin 45° = cos 45°

  const cases: Array<[SeatIndex, SeatPose]> = [
    [0, { position: { x:        0, y: 0, z:       R }, facing: { x:    0, y: 0, z:    -1 } }],
    [1, { position: { x: -R * s45, y: 0, z: R * s45 }, facing: { x:  s45, y: 0, z:  -s45 } }],
    [2, { position: { x:       -R, y: 0, z:       0 }, facing: { x:    1, y: 0, z:     0 } }],
    [3, { position: { x: -R * s45, y: 0, z:-R * s45 }, facing: { x:  s45, y: 0, z:   s45 } }],
    [4, { position: { x:        0, y: 0, z:      -R }, facing: { x:    0, y: 0, z:     1 } }],
    [5, { position: { x:  R * s45, y: 0, z:-R * s45 }, facing: { x: -s45, y: 0, z:   s45 } }],
    [6, { position: { x:        R, y: 0, z:       0 }, facing: { x:   -1, y: 0, z:     0 } }],
    [7, { position: { x:  R * s45, y: 0, z: R * s45 }, facing: { x: -s45, y: 0, z:  -s45 } }],
  ];

  test.each(cases)('seat %i', (i, expected) => {
    const a = getSeatLayout('circle', i);
    expect(a.position.x).toBeCloseTo(expected.position.x, 10);
    expect(a.position.y).toBeCloseTo(expected.position.y, 10);
    expect(a.position.z).toBeCloseTo(expected.position.z, 10);
    expect(a.facing.x  ).toBeCloseTo(expected.facing.x,   10);
    expect(a.facing.y  ).toBeCloseTo(expected.facing.y,   10);
    expect(a.facing.z  ).toBeCloseTo(expected.facing.z,   10);
  });
});

describe('getSeatLayout — invariants', () => {
  test('every facing is a unit vector', () => {
    for (const shape of SHAPES) {
      for (const i of ALL_INDICES) {
        const { facing } = getSeatLayout(shape, i);
        const len = Math.hypot(facing.x, facing.y, facing.z);
        expect(len).toBeCloseTo(1, 10);
      }
    }
  });

  test('every facing has a positive component toward the table centre', () => {
    for (const shape of SHAPES) {
      for (const i of ALL_INDICES) {
        const { position, facing } = getSeatLayout(shape, i);
        const dot = facing.x * -position.x + facing.y * -position.y + facing.z * -position.z;
        expect(dot).toBeGreaterThan(0);
      }
    }
  });
});
