import * as THREE from 'three';

// Project `ray` onto a line through `origin` along unit `axis`.
// Uses the plane containing the axis whose normal faces the camera so
// near-parallel views stay numerically stable. Returns the signed
// offset along `axis` from `origin`, or null if degenerate.
export function projectRayOntoAxis(
  ray:       THREE.Ray,
  origin:    THREE.Vector3,
  axis:      THREE.Vector3,
  cameraPos: THREE.Vector3,
): number | null {
  const toCam  = new THREE.Vector3().subVectors(cameraPos, origin);
  const normal = toCam.clone().addScaledVector(axis, -toCam.dot(axis));
  if (normal.lengthSq() < 1e-6) return null;
  normal.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  const hit   = new THREE.Vector3();
  if (!ray.intersectPlane(plane, hit)) return null;
  return hit.sub(origin).dot(axis);
}
