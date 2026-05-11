// Component-driven editor-panel tool aggregation. Mirrors `aggregateContextMenu`
// but feeds the host editor panel rather than the right-click menu. Walks an
// entity's components in topological order, calls `onEditorTools` on each,
// and concatenates the results. Each interactive item is tagged with the
// owning component's typeId so the click router can dispatch through
// `onAction`.

import { type Entity } from './Entity';
import { type MenuContext, type ActionContext } from './EntityComponent';
import { componentRegistry } from './ComponentRegistry';

export type EditorToolItem =
  | {
      kind:  'button';
      id:    string;
      label: string;
      componentTypeId?: string;
      disabled?:        boolean;
      args?:            object;
    }
  | { kind: 'heading'; label: string }
  | {
      kind:  'number';
      id:    string;
      label?: string;
      value: number;
      componentTypeId?: string;
      args?: object;
      step?: number;
      min?:  number;
      max?:  number;
    }
  | {
      kind:  'boolean';
      id:    string;
      label?: string;
      value: boolean;
      componentTypeId?: string;
      args?: object;
    }
  // Visual grouping of interactive items in a single horizontal row. Used by
  // SnapPointsComponent so each per-point editor (x/y/z/yaw/r + snap-rot +
  // delete) is rendered inline.
  | { kind: 'row'; items: EditorToolItem[] };

export function aggregateEditorTools(entity: Entity, ctx: MenuContext): EditorToolItem[] {
  // Editor panel is host-only; non-host callers get an empty list.
  if (!ctx.isHost) return [];

  const typeIds = [...entity.components.keys()];
  if (typeIds.length === 0) return [];

  const order = componentRegistry.getSpawnOrder(typeIds);
  const out: EditorToolItem[] = [];
  for (const cls of order) {
    const comp = entity.components.get(cls.typeId);
    if (!comp) continue;
    const items = comp.onEditorTools(ctx);
    if (items.length === 0) continue;
    for (const item of items) out.push(tagItem(item, cls.typeId));
  }
  return out;
}

function tagItem(item: EditorToolItem, componentTypeId: string): EditorToolItem {
  if (item.kind === 'button' || item.kind === 'number' || item.kind === 'boolean') {
    return item.componentTypeId ? item : { ...item, componentTypeId };
  }
  if (item.kind === 'row') {
    return { kind: 'row', items: item.items.map(i => tagItem(i, componentTypeId)) };
  }
  return item;
}

// Cross-entity editor-tool actions that need scene/world-level access. The
// dispatcher routes these to host-local callbacks rather than `comp.onAction`,
// since components don't get a clean path to spawn child entities. Mirrors
// how `dispatchMenuAction` handles `__delete` and the deck verbs.
import { type EditorElementKind } from './components/SurfaceElement';

export interface EditorToolDeps {
  entity:    Entity | undefined;
  hostLocal: {
    attachSurface: (parentId: string) => void;
    attachElement: (surfaceId: string, kind: EditorElementKind) => void;
  };
  // Optional. Fired after `onAction` so the React panel can refresh —
  // `comp.setState` replicates and updates view artefacts but does not by
  // itself trigger a `World` subscriber pass. Wire this on host callers that
  // want add/delete/edit to immediately repaint the panel.
  notify?:   () => void;
}

const SURFACE_ELEMENT_ACTIONS: Record<string, EditorElementKind> = {
  'add-rich':         'rich',
  'add-image':        'image',
  'add-shape-rect':   'shape-rect',
  'add-shape-circle': 'shape-circle',
  'add-button':       'button',
};

export function dispatchEditorTool(
  item:     EditorToolItem,
  value:    unknown,
  entityId: string,
  deps:     EditorToolDeps,
): void {
  if (item.kind === 'heading' || item.kind === 'row') return;

  if (item.kind === 'button' && item.componentTypeId === 'mesh' && item.id === 'add-surface') {
    deps.hostLocal.attachSurface(entityId);
    return;
  }
  if (item.kind === 'button' && item.componentTypeId === 'surface') {
    const kind = SURFACE_ELEMENT_ACTIONS[item.id];
    if (kind) {
      deps.hostLocal.attachElement(entityId, kind);
      return;
    }
  }

  if (!item.componentTypeId || !deps.entity) return;
  const comp = deps.entity.components.get(item.componentTypeId);
  if (!comp) return;
  const ctx: ActionContext = { recipientSeat: null, isHost: true, entity: deps.entity };

  let args: object | undefined;
  if (item.kind === 'number' || item.kind === 'boolean') {
    args = { ...(item.args ?? {}), value };
  } else {
    args = item.args;
  }
  comp.onAction(item.id, args, ctx);
  deps.notify?.();
}
