import * as THREE from 'three';
import { assetService } from '../assets/AssetService';

// Skydome — large inverted sphere rendered behind everything else. The
// `textureUrl` prop is the equirectangular image painted onto its inner face.
// An empty url falls back to a solid colour so the scene doesn't go black on
// boot before any texture has loaded. Texture loads route through AssetService
// for caching + dedup; broken URLs render the magenta placeholder colour
// (visible signal that the configured ref didn't resolve).

export interface SkydomeProps {
  textureUrl: string;
}

export const DEFAULT_SKYDOME_PROPS: SkydomeProps = {
  textureUrl: '',
};

const SKYDOME_RADIUS = 250;
const FALLBACK_HEX   = 0x1a1a2e;
const BROKEN_HEX     = 0xff00ff;

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

    const prevUnsub = mesh.userData.skydomeUnsub as (() => void) | undefined;
    prevUnsub?.();
    mesh.userData.skydomeUnsub = undefined;

    const ownedClone = mesh.userData.skydomeMapClone as THREE.Texture | undefined;
    if (!url) {
      mat.map = null;
      mat.color.setHex(FALLBACK_HEX);
      mat.needsUpdate = true;
      ownedClone?.dispose();
      mesh.userData.skydomeMapClone = undefined;
    } else {
      mesh.userData.skydomeUnsub = assetService.subscribe(url, 'image', (tex, status) => {
        const previous = mesh.userData.skydomeMapClone as THREE.Texture | undefined;
        if (status === 'loaded') {
          // Clone so equirectangular config doesn't bleed onto consumers using
          // the same ref as a flat map.
          const clone = tex.clone();
          clone.mapping     = THREE.EquirectangularReflectionMapping;
          clone.colorSpace  = THREE.SRGBColorSpace;
          clone.needsUpdate = true;
          mat.map           = clone;
          mat.color.setHex(0xffffff);
          mesh.userData.skydomeMapClone = clone;
        } else {
          mat.map = null;
          mat.color.setHex(status === 'broken' ? BROKEN_HEX : FALLBACK_HEX);
          mesh.userData.skydomeMapClone = undefined;
        }
        mat.needsUpdate = true;
        if (previous && previous !== mat.map) previous.dispose();
      });
    }
  }

  mesh.userData.skydomeProps = props;
}
