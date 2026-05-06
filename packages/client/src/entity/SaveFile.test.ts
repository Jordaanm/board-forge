import { describe, test, expect } from 'vitest';
import {
  SAVE_FORMAT,
  SAVE_VERSION,
  encodeSaveFile,
  decodeSaveFile,
  defaultSaveFilename,
  SaveFileError,
} from './SaveFile';
import { type EntitySerialized } from './Scene';
import { registerCorePrimitives } from './spawnables';

registerCorePrimitives();

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

describe('SaveFile.encode', () => {
  test('produces an envelope with expected fields', () => {
    const env = encodeSaveFile({ scene: sampleScene, thumbnail: null, savedAt: '2026-05-06T12:00:00.000Z' });
    expect(env.format).toBe(SAVE_FORMAT);
    expect(env.version).toBe(SAVE_VERSION);
    expect(env.savedAt).toBe('2026-05-06T12:00:00.000Z');
    expect(env.thumbnail).toBeNull();
    expect(env.scene).toEqual(sampleScene);
    expect(env.script).toEqual({ source: '', initialised: false });
  });

  test('defaults savedAt to current ISO timestamp', () => {
    const env = encodeSaveFile({ scene: [], thumbnail: null });
    expect(typeof env.savedAt).toBe('string');
    expect(env.savedAt.length).toBeGreaterThan(0);
  });

  test('carries the supplied script through', () => {
    const env = encodeSaveFile({
      scene:     [],
      thumbnail: null,
      script:    { source: 'export default class extends Game {}', initialised: true },
    });
    expect(env.script).toEqual({ source: 'export default class extends Game {}', initialised: true });
  });
});

describe('SaveFile round-trip', () => {
  test('encode → JSON → decode preserves the scene', () => {
    const env = encodeSaveFile({
      scene:     sampleScene,
      thumbnail: 'data:image/png;base64,iVBORw0KGgo=',
      savedAt:   '2026-05-06T12:00:00.000Z',
    });
    const text    = JSON.stringify(env);
    const decoded = decodeSaveFile(text);
    expect(decoded.scene).toEqual(sampleScene);
    expect(decoded.thumbnail).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(decoded.savedAt).toBe('2026-05-06T12:00:00.000Z');
  });

  test('encode → JSON → decode preserves the script slot', () => {
    const env = encodeSaveFile({
      scene:     [],
      thumbnail: null,
      script:    { source: 'src here', initialised: true },
    });
    const decoded = decodeSaveFile(JSON.stringify(env));
    expect(decoded.script).toEqual({ source: 'src here', initialised: true });
  });

  test('decode tolerates missing optional fields', () => {
    const text = JSON.stringify({
      format:  SAVE_FORMAT,
      version: SAVE_VERSION,
      scene:   [],
    });
    const decoded = decodeSaveFile(text);
    expect(decoded.thumbnail).toBeNull();
    expect(decoded.savedAt).toBe('');
    expect(decoded.scene).toEqual([]);
    // Pre-scripting saves carry no `script` field — decode treats as empty.
    expect(decoded.script).toEqual({ source: '', initialised: false });
  });

  test('decode tolerates a null script (older draft)', () => {
    const text = JSON.stringify({
      format:  SAVE_FORMAT,
      version: SAVE_VERSION,
      scene:   [],
      script:  null,
    });
    const decoded = decodeSaveFile(text);
    expect(decoded.script).toEqual({ source: '', initialised: false });
  });
});

describe('SaveFile.decode validation', () => {
  test('rejects invalid JSON', () => {
    expect(() => decodeSaveFile('not json')).toThrow(SaveFileError);
  });

  test('rejects unknown format', () => {
    const text = JSON.stringify({ format: 'other', version: 1, scene: [] });
    expect(() => decodeSaveFile(text)).toThrow(/format/i);
  });

  test('rejects unknown version', () => {
    const text = JSON.stringify({ format: SAVE_FORMAT, version: 99, scene: [] });
    expect(() => decodeSaveFile(text)).toThrow(/version/i);
  });

  test('rejects missing scene', () => {
    const text = JSON.stringify({ format: SAVE_FORMAT, version: 1 });
    expect(() => decodeSaveFile(text)).toThrow(/scene/i);
  });

  test('rejects unknown component typeId', () => {
    const bad: EntitySerialized = {
      id:            'd-1',
      type:          'die',
      name:          'Die',
      tags:          [],
      owner:         null,
      privateToSeat: null,
      parentId:      null,
      children:      [],
      components: { unknownComponent: {} },
    };
    const text = JSON.stringify({ format: SAVE_FORMAT, version: 1, scene: [bad] });
    expect(() => decodeSaveFile(text)).toThrow(/unknown component/i);
  });

  test('rejects non-object root', () => {
    expect(() => decodeSaveFile('[]')).toThrow(SaveFileError);
  });

  test('rejects malformed script (string)', () => {
    const text = JSON.stringify({
      format:  SAVE_FORMAT,
      version: SAVE_VERSION,
      scene:   [],
      script:  'not an object',
    });
    expect(() => decodeSaveFile(text)).toThrow(/script/i);
  });

  test('rejects malformed script.source', () => {
    const text = JSON.stringify({
      format:  SAVE_FORMAT,
      version: SAVE_VERSION,
      scene:   [],
      script:  { source: 42, initialised: false },
    });
    expect(() => decodeSaveFile(text)).toThrow(/source/i);
  });

  test('rejects malformed script.initialised', () => {
    const text = JSON.stringify({
      format:  SAVE_FORMAT,
      version: SAVE_VERSION,
      scene:   [],
      script:  { source: '', initialised: 'yes' },
    });
    expect(() => decodeSaveFile(text)).toThrow(/initialised/i);
  });
});

describe('defaultSaveFilename', () => {
  test('uses ISO date prefix', () => {
    expect(defaultSaveFilename('2026-05-06T12:00:00.000Z')).toBe('vtt-scene-2026-05-06.json');
  });

  test('falls back when timestamp is empty', () => {
    expect(defaultSaveFilename('')).toBe('vtt-scene-unknown.json');
  });
});
