import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import {
  resolveFaceFromOrientation,
  orientationForValue,
} from './diceFaceResolver';
import { D6_FACE_MAP as D6_MAP } from './d6';

// Build a body quaternion from an axis-angle pair.
function quatAxisAngle(ax: number, ay: number, az: number, angle: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax, ay, az), angle);
  return [q.x, q.y, q.z, q.w];
}

describe('resolveFaceFromOrientation — canonical orientations', () => {
  test('identity quaternion resolves to face 1 (+Y up)', () => {
    expect(resolveFaceFromOrientation(0, 0, 0, 1, D6_MAP)).toBe(1);
  });

  // For each face, rotate the body so that face's local up-axis points to
  // world +Y, then verify the resolver names that face.
  const cases: Array<[number, [number, number, number, number]]> = [
    [1, [0, 0, 0, 1]],                                          // identity
    [6, quatAxisAngle(1, 0, 0, Math.PI)],                       // 180° around X
    [2, quatAxisAngle(1, 0, 0, -Math.PI / 2)],                  // -90° around X → +Z up
    [5, quatAxisAngle(1, 0, 0,  Math.PI / 2)],                  //  90° around X → -Z up
    [3, quatAxisAngle(0, 0, 1,  Math.PI / 2)],                  //  90° around Z → +X up
    [4, quatAxisAngle(0, 0, 1, -Math.PI / 2)],                  // -90° around Z → -X up
  ];

  test.each(cases)('face %i is up under its canonical orientation', (expected, q) => {
    const [qx, qy, qz, qw] = q;
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(expected);
  });
});

describe('resolveFaceFromOrientation — partial tilts', () => {
  test('30° tilt around Z still resolves to face 1', () => {
    const [qx, qy, qz, qw] = quatAxisAngle(0, 0, 1, Math.PI / 6);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(1);
  });

  test('60° tilt around Z crosses over to face 3', () => {
    const [qx, qy, qz, qw] = quatAxisAngle(0, 0, 1, Math.PI / 3);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(3);
  });

  test('30° tilt around X still resolves to face 1', () => {
    const [qx, qy, qz, qw] = quatAxisAngle(1, 0, 0, Math.PI / 6);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(1);
  });
});

describe('resolveFaceFromOrientation — exact ties pick lower value', () => {
  test('45° tilt around Z (face 1 vs face 3) returns 1', () => {
    const [qx, qy, qz, qw] = quatAxisAngle(0, 0, 1, Math.PI / 4);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(1);
  });

  test('45° tilt around X (face 1 vs face 5) returns 1', () => {
    const [qx, qy, qz, qw] = quatAxisAngle(1, 0, 0, Math.PI / 4);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(1);
  });

  test('135° tilt around Z (face 6 vs face 3) returns 3', () => {
    // localUp lands halfway between -Y and +X; tie resolves to lower value.
    const [qx, qy, qz, qw] = quatAxisAngle(0, 0, 1, (3 * Math.PI) / 4);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(3);
  });
});

describe('resolveFaceFromOrientation — error paths', () => {
  test('throws when face map is empty', () => {
    expect(() => resolveFaceFromOrientation(0, 0, 0, 1, [])).toThrow();
  });
});

describe('orientationForValue', () => {
  test('value 1 returns identity (or numerically equivalent)', () => {
    const [qx, qy, qz, qw] = orientationForValue(1, D6_MAP);
    // Identity is (0,0,0,±1). Verify by applying to local +Y and checking it
    // lands on world +Y.
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(qx, qy, qz, qw));
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  test('throws when value is not in the face map', () => {
    expect(() => orientationForValue(7, D6_MAP)).toThrow();
  });
});

describe('round-trip — orientationForValue → resolveFaceFromOrientation', () => {
  test.each(D6_MAP.map(f => f.value))('value %i round-trips', (v) => {
    const [qx, qy, qz, qw] = orientationForValue(v, D6_MAP);
    expect(resolveFaceFromOrientation(qx, qy, qz, qw, D6_MAP)).toBe(v);
  });
});
