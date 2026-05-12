// Component-driven context menu aggregation. Walks an entity's components in
// topological order, calls `getActions` + `getMenuControls` on each, and
// concatenates the non-empty groups with a single separator between them.
// Each item is tagged with the owning component's typeId so the click
// handler can route it through `dispatchAction` or the menu-control branch.

import { type Entity } from './Entity';
import { type ActionContext, type ActionDefinition, type MenuItem } from './EntityComponent';
import { componentRegistry } from './ComponentRegistry';

export function aggregateContextMenu(entity: Entity, ctx: ActionContext): MenuItem[] {
  // Spectators (no seat, not host) get an empty menu.
  if (!ctx.isHost && ctx.recipientSeat === null) return [];

  const typeIds = [...entity.components.keys()];
  if (typeIds.length === 0) return [];

  const order = componentRegistry.getSpawnOrder(typeIds);
  const out: MenuItem[] = [];
  for (const cls of order) {
    const comp = entity.components.get(cls.typeId);
    if (!comp) continue;
    const actions  = comp.getActions(ctx).map(actionToMenuItem);
    const controls = comp.getMenuControls(ctx);
    const items    = [...actions, ...controls];
    if (items.length === 0) continue;
    if (out.length > 0) out.push({ kind: 'separator' });
    for (const item of items) out.push(tagAction(item, cls.typeId));
  }
  return out;
}

function actionToMenuItem(def: ActionDefinition): MenuItem {
  const item: MenuItem & { kind: 'action' } = { kind: 'action', id: def.name, label: def.label };
  if (def.enabled === false) item.disabled = true;
  return item;
}

function tagAction(item: MenuItem, componentTypeId: string): MenuItem {
  if (item.kind === 'action' || item.kind === 'colorpicker' || item.kind === 'numeric') {
    return item.componentTypeId
      ? item
      : { ...item, componentTypeId };
  }
  if (item.kind === 'submenu') {
    return { ...item, items: item.items.map(i => tagAction(i, componentTypeId)) };
  }
  return item;
}
