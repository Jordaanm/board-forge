import { type SpawnableType } from '../net/SceneState';
import { getSpawnable } from '../entity/SpawnableRegistry';

// Metadata used by EditorPanel + ContextMenuController. Keeps only display
// labels, editable property schemas, and spawnable actions — the v1
// createMesh / createBody / applyProp methods now live on the v2 components.
// Slices #5 and #7 will rewrite the controllers against components and this
// table goes away.

export type ActionDef   = { id: string; label: string };
export type PropertyDef = { key: string; label: string; type: 'number' | 'string' | 'color' | 'boolean' | 'seat' };

export interface ObjectMeta {
  type:           SpawnableType;
  label:          string;
  propertySchema: PropertyDef[];
  actions:        ActionDef[];
}

export const OBJECT_META: Record<string, ObjectMeta> = {
  board: {
    type:  'board',
    label: 'Board',
    propertySchema: [
      { key: 'name',       label: 'Name',    type: 'string' },
      { key: 'width',      label: 'Width',   type: 'number' },
      { key: 'depth',      label: 'Depth',   type: 'number' },
      { key: 'textureUrl', label: 'Texture', type: 'string' },
    ],
    actions: [],
  },
  die: {
    type:  'die',
    label: 'Die (D6)',
    propertySchema: [
      { key: 'name', label: 'Name', type: 'string' },
    ],
    actions: [{ id: 'roll', label: 'Roll' }],
  },
  token: {
    type:  'token',
    label: 'Token',
    propertySchema: [
      { key: 'name',  label: 'Name',  type: 'string' },
      { key: 'color', label: 'Color', type: 'color' },
    ],
    actions: [],
  },
  zone: {
    type:  'zone',
    label: 'Zone',
    propertySchema: [
      { key: 'name',         label: 'Name',           type: 'string'  },
      { key: 'halfExtentsX', label: 'Half-extent X',  type: 'number'  },
      { key: 'halfExtentsY', label: 'Half-extent Y',  type: 'number'  },
      { key: 'halfExtentsZ', label: 'Half-extent Z',  type: 'number'  },
      { key: 'isVisible',    label: 'Show debug box', type: 'boolean' },
    ],
    actions: [],
  },
  hand: {
    type:  'hand',
    label: 'Hand',
    propertySchema: [
      { key: 'name',         label: 'Name',           type: 'string'  },
      { key: 'owner',        label: 'Owner seat',     type: 'seat'    },
      { key: 'isMainHand',   label: 'Main hand',      type: 'boolean' },
      { key: 'isPrivate',    label: 'Private',        type: 'boolean' },
      { key: 'halfExtentsX', label: 'Half-extent X',  type: 'number'  },
      { key: 'halfExtentsY', label: 'Half-extent Y',  type: 'number'  },
      { key: 'halfExtentsZ', label: 'Half-extent Z',  type: 'number'  },
      { key: 'isVisible',    label: 'Show debug box', type: 'boolean' },
    ],
    actions: [],
  },
};

// Resolves a spawnable's display metadata, falling back to the registry's
// SpawnableDef.label when the type isn't in OBJECT_META. Used by EditorPanel
// so newly-registered types (e.g. `card`) don't crash the property editor.
export function resolveObjectMeta(type: SpawnableType): ObjectMeta {
  const m = OBJECT_META[type];
  if (m) return m;
  return {
    type,
    label:          getSpawnable(type)?.label ?? type,
    propertySchema: [{ key: 'name', label: 'Name', type: 'string' }],
    actions:        [],
  };
}
