import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { isFaceUpFromQuaternion } from './cardOrientation';

function quatAxisAngle(ax: number, ay: number, az: number, angle: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax, ay, az), angle);
  return [q.x, q.y, q.z, q.w];
}

describe('isFaceUpFromQuaternion', () => {
  const cases: Array<[string, [number, number, number, number], boolean]> = [
    ['identity (no rotation)',                  [0, 0, 0, 1],                        true],
    ['180° around X (flipped upside down)',     quatAxisAngle(1, 0, 0, Math.PI),     false],
    ['180° around Z (flipped sideways)',        quatAxisAngle(0, 0, 1, Math.PI),     false],
    ['90° around Z (on edge — face-up by ≥ 0)', quatAxisAngle(0, 0, 1, Math.PI / 2), true],
    ['90° around X (on edge — face-up by ≥ 0)', quatAxisAngle(1, 0, 0, Math.PI / 2), true],
    ['30° wobble around Z, still face up',      quatAxisAngle(0, 0, 1, Math.PI / 6), true],
    ['150° around Z, face down',                quatAxisAngle(0, 0, 1, 5 * Math.PI / 6), false],
    ['arbitrary yaw around Y, still face up',   quatAxisAngle(0, 1, 0, 1.2),         true],
  ];

  test.each(cases)('%s', (_label, q, expected) => {
    const [qx, qy, qz, qw] = q;
    expect(isFaceUpFromQuaternion(qx, qy, qz, qw)).toBe(expected);
  });
});
