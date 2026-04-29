// Feature flag selecting between the legacy SceneGraph and the v2 entity-
// component system. Slice #3 of issues--scene-graph.md.
//
// Sources, in priority order:
//   1. URL search param `?sceneV2=1`
//   2. Vite env  `import.meta.env.VITE_SCENE_V2`
//   3. Default: off.

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);

// Pure reader — easier to test than reading window/import.meta directly.
export function readSceneV2Flag(search: string | null, env: string | undefined): boolean {
  if (search) {
    const v = new URLSearchParams(search).get('sceneV2');
    if (v !== null) return TRUTHY.has(v.toLowerCase());
  }
  if (env !== undefined) return TRUTHY.has(env.toLowerCase());
  return false;
}

export function isSceneV2Enabled(): boolean {
  const search =
    typeof window !== 'undefined' && window.location?.search ? window.location.search : null;
  let env: string | undefined;
  try {
    const im = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    env = im?.VITE_SCENE_V2;
  } catch {
    // ignore — non-Vite environments
  }
  return readSceneV2Flag(search, env);
}
