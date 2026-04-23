import { describe, test, expect } from 'vitest';
import { OBJECT_TYPE_REGISTRY, defaultObjectName, type ObjectTypeDef } from './objectTypes';
import { type SpawnableType } from '../net/SceneState';

const TYPES: SpawnableType[] = ['board', 'die', 'token'];

function isValidDef(def: ObjectTypeDef): boolean {
  return (
    typeof def.type              === 'string' &&
    typeof def.label             === 'string' &&
    typeof def.isThrowable       === 'boolean' &&
    typeof def.spawnHeight       === 'number'  &&
    typeof def.createMesh        === 'function' &&
    typeof def.createBody        === 'function' &&
    typeof def.applyProp         === 'function' &&
    typeof def.defaultProps      === 'object'  &&
    Array.isArray(def.propertySchema) &&
    Array.isArray(def.actions)
  );
}

describe('OBJECT_TYPE_REGISTRY', () => {
  test('contains all required types', () => {
    for (const t of TYPES) expect(OBJECT_TYPE_REGISTRY).toHaveProperty(t);
  });

  for (const t of TYPES) {
    describe(t, () => {
      const def = OBJECT_TYPE_REGISTRY[t];

      test('has all required fields', () => {
        expect(isValidDef(def)).toBe(true);
      });

      test('type field matches key', () => {
        expect(def.type).toBe(t);
      });

      test('propertySchema entries have key, label, type', () => {
        for (const p of def.propertySchema) {
          expect(typeof p.key).toBe('string');
          expect(typeof p.label).toBe('string');
          expect(['number', 'string', 'color']).toContain(p.type);
        }
      });

      test('actions entries have id and label', () => {
        for (const a of def.actions) {
          expect(typeof a.id).toBe('string');
          expect(typeof a.label).toBe('string');
        }
      });

      test('spawnHeight is positive', () => {
        expect(def.spawnHeight).toBeGreaterThan(0);
      });

      test('exposes a string "name" property in its schema', () => {
        const nameProp = def.propertySchema.find(p => p.key === 'name');
        expect(nameProp).toBeDefined();
        expect(nameProp?.type).toBe('string');
      });
    });
  }
});

describe('defaultObjectName', () => {
  test('uses the type label and preserves the counter suffix', () => {
    expect(defaultObjectName('board', 'board-0')).toBe('Board-0');
    expect(defaultObjectName('die',   'die-3')).toBe('Die (D6)-3');
    expect(defaultObjectName('token', 'token-42')).toBe('Token-42');
  });

  test('falls back to the full id when the prefix does not match', () => {
    expect(defaultObjectName('board', 'custom-id')).toBe('Board-custom-id');
  });
});
