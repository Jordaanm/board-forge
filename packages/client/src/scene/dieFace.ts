import * as THREE from 'three';

const _qInv    = new THREE.Quaternion();
const _localUp = new THREE.Vector3();

export function getDieFace(qx: number, qy: number, qz: number, qw: number): number {
  _qInv.set(-qx, -qy, -qz, qw);
  _localUp.set(0, 1, 0).applyQuaternion(_qInv);

  const ax = Math.abs(_localUp.x), ay = Math.abs(_localUp.y), az = Math.abs(_localUp.z);
  if (ay >= ax && ay >= az) return _localUp.y > 0 ? 1 : 6;
  if (ax >= ay && ax >= az) return _localUp.x > 0 ? 2 : 5;
  return _localUp.z > 0 ? 3 : 4;
}
