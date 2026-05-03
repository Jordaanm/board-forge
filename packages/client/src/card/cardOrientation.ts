// Pure orientation → face-up math for cards. Slice 3 of issues--card.md.
// Independent of CANNON and the entity/component layer so it can be
// unit-tested without spinning up physics or the scene graph.

import * as THREE from 'three';

const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const _quat    = new THREE.Quaternion();
const _v       = new THREE.Vector3();

// A card's face sits on the local +Y axis. Apply the card's orientation to
// (0, 1, 0); the card is face-up iff the resulting world-Y component is
// non-negative. Edge cases (card balanced exactly on edge) resolve to
// face-up by the `>= 0` rule — transient state, doesn't matter for
// replication.
export function isFaceUpFromQuaternion(
  qx: number, qy: number, qz: number, qw: number,
): boolean {
  _quat.set(qx, qy, qz, qw);
  _v.copy(LOCAL_UP).applyQuaternion(_quat);
  return _v.y >= 0;
}
