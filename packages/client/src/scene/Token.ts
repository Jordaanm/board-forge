import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TABLE_SURFACE_Y } from './Table';

export const TOKEN_RADIUS = 0.5;
export const TOKEN_HEIGHT = 0.15;

export function createTokenMesh(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(TOKEN_RADIUS, TOKEN_RADIUS, TOKEN_HEIGHT, 24);
  const mat = new THREE.MeshLambertMaterial({ color: 0xcc2222 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createTokenBody(): CANNON.Body {
  return new CANNON.Body({
    mass: 0.1,
    linearDamping: 0.4,
    angularDamping: 0.8,
    shape: new CANNON.Cylinder(TOKEN_RADIUS, TOKEN_RADIUS, TOKEN_HEIGHT, 16),
    position: new CANNON.Vec3(0, TABLE_SURFACE_Y + TOKEN_HEIGHT / 2 + 0.5, 0),
  });
}
