import { describe, test, expect } from 'vitest';
import { readSceneV2Flag } from './featureFlag';

describe('readSceneV2Flag', () => {
  test('defaults off when both sources are absent', () => {
    expect(readSceneV2Flag(null, undefined)).toBe(false);
  });

  test('URL ?sceneV2=1 enables', () => {
    expect(readSceneV2Flag('?sceneV2=1', undefined)).toBe(true);
  });

  test.each(['true', 'on', 'yes', 'TRUE', 'YES'])('URL ?sceneV2=%s enables', (v) => {
    expect(readSceneV2Flag(`?sceneV2=${v}`, undefined)).toBe(true);
  });

  test('URL ?sceneV2=0 disables', () => {
    expect(readSceneV2Flag('?sceneV2=0', undefined)).toBe(false);
  });

  test('unrelated URL params do not enable', () => {
    expect(readSceneV2Flag('?other=1', undefined)).toBe(false);
  });

  test('env VITE_SCENE_V2=1 enables when URL silent', () => {
    expect(readSceneV2Flag(null, '1')).toBe(true);
  });

  test('URL takes priority over env', () => {
    expect(readSceneV2Flag('?sceneV2=0', '1')).toBe(false);
  });
});
