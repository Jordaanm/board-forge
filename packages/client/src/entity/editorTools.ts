// Component-driven editor-panel tool aggregation. Mirrors `aggregateContextMenu`
// but feeds the host editor panel rather than the right-click menu. Walks an
// entity's components in topological order, calls `onEditorTools` on each,
// and concatenates the results. Each button is tagged with the owning
// component's typeId so the click router can dispatch through `onAction`.

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
  | { kind: 'heading'; label: string };

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
  if (item.kind === 'button') {
    return item.componentTypeId ? item : { ...item, componentTypeId };
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
}

const SURFACE_ELEMENT_ACTIONS: Record<string, EditorElementKind> = {
  'add-rich':         'rich',
  'add-image':        'image',
  'add-shape-rect':   'shape-rect',
  'add-shape-circle': 'shape-circle',
};

export function dispatchEditorTool(
  item:    EditorToolItem & { kind: 'button' },
  args:    object | undefined,
  entityId: string,
  deps:    EditorToolDeps,
): void {
  if (item.componentTypeId === 'mesh' && item.id === 'add-surface') {
    deps.hostLocal.attachSurface(entityId);
    return;
  }
  if (item.componentTypeId === 'surface') {
    const kind = SURFACE_ELEMENT_ACTIONS[item.id];
    if (kind) {
      deps.hostLocal.attachElement(entityId, kind);
      return;
    }
  }

  // Component-defined buttons fall through to onAction on the owning
  // component, mirroring the menu dispatch path.
  if (!item.componentTypeId || !deps.entity) return;
  const comp = deps.entity.components.get(item.componentTypeId);
  if (!comp) return;
  const ctx: ActionContext = { recipientSeat: null, isHost: true, entity: deps.entity };
  comp.onAction(item.id, args, ctx);
}
