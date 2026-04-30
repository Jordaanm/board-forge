import { type SpawnableType } from '../net/SceneState';

// Metadata used by EditorPanel + ContextMenuController. Keeps only display
// labels, editable property schemas, and spawnable actions — the v1
// createMesh / createBody / applyProp methods now live on the v2 components.
// Slices #5 and #7 will rewrite the controllers against components and this
// table goes away.

export type ActionDef   = { id: string; label: string };
export type PropertyDef = { key: string; label: string; type: 'number' | 'string' | 'color' };

export interface ObjectMeta {
  type:           SpawnableType;
  label:          string;
  propertySchema: PropertyDef[];
  actions:        ActionDef[];
}

export const OBJECT_META: Record<SpawnableType, ObjectMeta> = {
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
};
