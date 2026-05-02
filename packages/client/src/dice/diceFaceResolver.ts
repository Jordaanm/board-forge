// Pure orientation ↔ face-value math for dice. Slice 1 of issues--dice.md.
// Independent of CANNON and the entity/component layer so it can be unit-tested
// without spinning up physics or the scene graph.

import * as THREE from 'three';

export interface FaceEntry {
  value:  number;
  upAxis: [number, number, number];   // unit vector in the die's local frame
}

const WORLD_UP    = new THREE.Vector3(0, 1, 0);
const TIE_EPSILON = 1e-6;

const _quat    = new THREE.Quaternion();
const _localUp = new THREE.Vector3();
const _from    = new THREE.Vector3();

// Pick the face whose local up-axis is closest to world +Y given the die's
// current orientation. Ties (within TIE_EPSILON of the best score) resolve to
// the lower face value, so a die balanced exactly between two faces gives a
// deterministic answer.
export function resolveFaceFromOrientation(
  qx: number, qy: number, qz: number, qw: number,
  faceMap: readonly FaceEntry[],
): number {
  if (faceMap.length === 0) throw new Error('faceMap must not be empty');

  _quat.set(qx, qy, qz, qw).invert();
  _localUp.copy(WORLD_UP).applyQuaternion(_quat);

  let bestScore = -Infinity;
  let bestValue =  Infinity;
  for (const face of faceMap) {
    const [ax, ay, az] = face.upAxis;
    const score = ax * _localUp.x + ay * _localUp.y + az * _localUp.z;
    if (score > bestScore + TIE_EPSILON) {
      bestScore = score;
      bestValue = face.value;
    } else if (score >= bestScore - TIE_EPSILON && face.value < bestValue) {
      bestValue = face.value;
    }
  }
  return bestValue;
}

// Shortest-arc quaternion that rotates the named face's up-axis to world +Y.
// Yaw about world-up is left at the natural shortest-arc choice — callers that
// care about a specific yaw must apply their own follow-up rotation.
export function orientationForValue(
  value: number,
  faceMap: readonly FaceEntry[],
): [number, number, number, number] {
  const face = faceMap.find(f => f.value === value);
  if (!face) throw new Error(`No face with value ${value} in face map`);
  _from.set(face.upAxis[0], face.upAxis[1], face.upAxis[2]).normalize();
  _quat.setFromUnitVectors(_from, WORLD_UP);
  return [_quat.x, _quat.y, _quat.z, _quat.w];
}
