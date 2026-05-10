import { describe, test, expect, vi, beforeEach } from 'vitest';
import { type EntitySerialized } from './Scene';
import { type AssetEntry } from '../assets/Manifest';
import { SAVE_FORMAT, SAVE_VERSION, type SaveEnvelope } from './SaveFile';
import { registerCorePrimitives } from './spawnables';

registerCorePrimitives();

const downloadMock = vi.fn();

vi.mock('./SaveFile', async () => {
  const actual = await vi.importActual<typeof import('./SaveFile')>('./SaveFile');
  return {
    ...actual,
    downloadSaveFile: (env: SaveEnvelope) => downloadMock(env),
  };
});

const { downloadSceneFile } = await import('./downloadSceneFile');

const sampleScene: EntitySerialized[] = [
  {
    id:            'd-1',
    type:          'die',
    name:          'Die',
    tags:          ['die'],
    owner:         null,
    privateToSeat: null,
    parentId:      null,
    children:      [],
    components: {
      transform: { position: [0, 5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      value:     { value: '6', isNumeric: true },
    },
  },
];

const sampleManifest: AssetEntry[] = [
  { slug: 'custom:m', name: 'M', type: 'image', url: 'http://x', preload: true },
];

describe('downloadSceneFile', () => {
  beforeEach(() => {
    downloadMock.mockReset();
  });

  test('invokes the download trigger with the encoded envelope', () => {
    downloadSceneFile(sampleScene, 'data:image/png;base64,xxx', sampleManifest, { source: 'src', initialised: true });
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const env = downloadMock.mock.calls[0][0] as SaveEnvelope;
    expect(env.format).toBe(SAVE_FORMAT);
    expect(env.version).toBe(SAVE_VERSION);
    expect(env.scene).toEqual(sampleScene);
    expect(env.thumbnail).toBe('data:image/png;base64,xxx');
    expect(env.manifest).toEqual(sampleManifest);
    expect(env.script).toEqual({ source: 'src', initialised: true });
    expect(typeof env.savedAt).toBe('string');
    expect(env.savedAt.length).toBeGreaterThan(0);
  });

  test('defaults script to empty when undefined', () => {
    downloadSceneFile([], null, [], undefined);
    const env = downloadMock.mock.calls[0][0] as SaveEnvelope;
    expect(env.script).toEqual({ source: '', initialised: false });
    expect(env.thumbnail).toBeNull();
    expect(env.manifest).toEqual([]);
    expect(env.scene).toEqual([]);
  });
});
