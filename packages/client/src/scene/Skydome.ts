import * as THREE from 'three';

// Skydome — large inverted sphere rendered behind everything else. The
// `textureUrl` prop is the equirectangular image painted onto its inner face.
// An empty url falls back to a solid colour so the scene doesn't go black on
// boot before any texture has loaded.

export interface SkydomeProps {
  textureUrl: string;
}

export const DEFAULT_SKYDOME_PROPS: SkydomeProps = {
  textureUrl: '',
};

const SKYDOME_RADIUS = 250;
const FALLBACK_HEX   = 0x1a1a2e;

export function createSkydome(props: SkydomeProps = DEFAULT_SKYDOME_PROPS): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKYDOME_RADIUS, 48, 24);
  const material = new THREE.MeshBasicMaterial({
    side:       THREE.BackSide,
    color:      FALLBACK_HEX,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;          // draw behind everything else
  mesh.userData.skydomeProps = { ...props };
  if (props.textureUrl) applySkydomeProp(mesh, 'textureUrl', props.textureUrl);
  return mesh;
}

export function applySkydomeProp(mesh: THREE.Mesh, key: keyof SkydomeProps, value: unknown): void {
  const props = (mesh.userData.skydomeProps ?? { ...DEFAULT_SKYDOME_PROPS }) as SkydomeProps;
  const mat   = mesh.material as THREE.MeshBasicMaterial;

  if (key === 'textureUrl') {
    const url = String(value ?? '');
    props.textureUrl = url;

    const oldMap = mat.map;
    if (!url) {
      mat.map = null;
      mat.color.setHex(FALLBACK_HEX);
      mat.needsUpdate = true;
      oldMap?.dispose();
    } else {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.mapping    = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
          oldMap?.dispose();
        },
        undefined,
        () => {
          // Load failure — leave the existing map / colour in place.
        },
      );
    }
  }

  mesh.userData.skydomeProps = props;
}
