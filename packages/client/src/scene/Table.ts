import * as THREE from 'three';

export const TABLE_SURFACE_Y = 0;
const TABLE_WIDTH = 12;
const TABLE_DEPTH = 8;
const TABLE_THICKNESS = 0.3;

export function createTable(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_DEPTH);
  const material = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = TABLE_SURFACE_Y - TABLE_THICKNESS / 2;
  mesh.receiveShadow = true;
  return mesh;
}
