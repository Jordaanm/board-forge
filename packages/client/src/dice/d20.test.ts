import { describe, test, expect } from 'vitest';
import {
  D20_VERTICES,
  D20_FACES,
  D20_FACE_MAP,
  D20_BOUNDING_SPHERE_RADIUS,
} from './d20';
import { resolveFaceFromOrientation, orientationForValue } from './diceFaceResolver';

describe('d20 — geometry invariants', () => {
  test('12 vertices, 20 faces', () => {
    expect(D20_VERTICES).toHaveLength(12);
    expect(D20_FACES).toHaveLength(20);
  });

  test('all vertices lie on the bounding sphere', () => {
    for (const [x, y, z] of D20_VERTICES) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(D20_BOUNDING_SPHERE_RADIUS, 10);
    }
  });

  test('every face winding gives an outward-pointing normal', () => {
    for (const face of D20_FACES) {
      const a = D20_VERTICES[face[0]];
      const b = D20_VERTICES[face[1]];
      const c = D20_VERTICES[face[2]];
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      expect(nx * cx + ny * cy + nz * cz).toBeGreaterThan(0);
    }
  });
});

describe('d20 — face map', () => {
  test('20 entries with values 1..20 each appearing once', () => {
    expect(D20_FACE_MAP).toHaveLength(20);
    const values = D20_FACE_MAP.map(f => f.value).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test('antipodal faces sum to 21', () => {
    for (let i = 0; i < D20_FACE_MAP.length; i++) {
      const a = D20_FACE_MAP[i].upAxis;
      const partner = D20_FACE_MAP.find(f =>
        Math.abs(f.upAxis[0] + a[0]) < 1e-9 &&
        Math.abs(f.upAxis[1] + a[1]) < 1e-9 &&
        Math.abs(f.upAxis[2] + a[2]) < 1e-9,
      );
      expect(partner).toBeDefined();
      expect(D20_FACE_MAP[i].value + partner!.value).toBe(21);
    }
  });

  test('upAxes are unit vectors', () => {
    for (const { upAxis } of D20_FACE_MAP) {
      const len = Math.hypot(upAxis[0], upAxis[1], upAxis[2]);
      expect(len).toBeCloseTo(1, 10);
    }
  });
});

describe('d20 — resolver round-trip', () => {
  test('orientationForValue(v) → resolveFaceFromOrientation = v for every face', () => {
    for (const { value } of D20_FACE_MAP) {
      const [qx, qy, qz, qw] = orientationForValue(value, D20_FACE_MAP);
      expect(resolveFaceFromOrientation(qx, qy, qz, qw, D20_FACE_MAP)).toBe(value);
    }
  });
});
