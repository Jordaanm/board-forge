import * as THREE from 'three';

// Key directional light — primary scene illumination + shadow caster. Color
// and intensity are configurable through the same scene-state plumbing as
// TableProps.

export interface KeyLightProps {
  color:     string;
  intensity: number;
}

export const DEFAULT_KEY_LIGHT_PROPS: KeyLightProps = {
  color:     '#fff1dc',
  intensity: 1.1,
};

export function createKeyLight(props: KeyLightProps = DEFAULT_KEY_LIGHT_PROPS): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(new THREE.Color(props.color), props.intensity);
  light.position.set(6, 14, 4);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.near   =  0.5;
  light.shadow.camera.far    = 40;
  light.shadow.camera.left   = -10;
  light.shadow.camera.right  =  10;
  light.shadow.camera.top    =  8;
  light.shadow.camera.bottom = -8;
  light.shadow.bias       = -0.0005;
  light.shadow.normalBias =  0.02;
  light.shadow.radius     =  4;
  light.userData.keyLightProps = { ...props };
  return light;
}

export function applyKeyLightProp(
  light: THREE.DirectionalLight,
  key:   keyof KeyLightProps,
  value: unknown,
): void {
  const props = (light.userData.keyLightProps ?? { ...DEFAULT_KEY_LIGHT_PROPS }) as KeyLightProps;
  if (key === 'color') {
    const next = String(value ?? DEFAULT_KEY_LIGHT_PROPS.color);
    props.color = next;
    light.color.set(next);
  } else if (key === 'intensity') {
    const next = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, value)
      : DEFAULT_KEY_LIGHT_PROPS.intensity;
    props.intensity = next;
    light.intensity = next;
  }
  light.userData.keyLightProps = props;
}
