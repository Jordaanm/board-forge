import * as THREE from 'three';

export const TABLE_SURFACE_Y = 0;
export const TABLE_WIDTH     = 12;
export const TABLE_DEPTH     = 8;
export const TABLE_THICKNESS = 0.3;

export type TableShape = 'rectangle' | 'circle';

export interface TableProps {
  shape: TableShape;
  color: string;
}

export const DEFAULT_TABLE_PROPS: TableProps = {
  shape: 'rectangle',
  color: '#4a3728',
};

function buildGeometry(shape: TableShape): THREE.BufferGeometry {
  if (shape === 'circle') {
    const radius = Math.min(TABLE_WIDTH, TABLE_DEPTH) / 2;
    return new THREE.CylinderGeometry(radius, radius, TABLE_THICKNESS, 64);
  }
  return new THREE.BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_DEPTH);
}

export function createTable(props: TableProps = DEFAULT_TABLE_PROPS): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({ color: props.color });
  const mesh = new THREE.Mesh(buildGeometry(props.shape), material);
  mesh.position.y = TABLE_SURFACE_Y - TABLE_THICKNESS / 2;
  mesh.receiveShadow = true;
  mesh.userData.tableProps = { ...props };
  return mesh;
}

export function applyTableProp(mesh: THREE.Mesh, key: keyof TableProps, value: unknown) {
  const props = (mesh.userData.tableProps ?? { ...DEFAULT_TABLE_PROPS }) as TableProps;
  if (key === 'shape') {
    props.shape = value as TableShape;
    mesh.geometry.dispose();
    mesh.geometry = buildGeometry(props.shape);
  } else if (key === 'color') {
    props.color = value as string;
    (mesh.material as THREE.MeshLambertMaterial).color.set(value as string);
  }
  mesh.userData.tableProps = props;
}
