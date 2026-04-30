// Component-driven context menu aggregation for slice #7.
// Walks an entity's components in topological order, calls `onContextMenu`
// on each, and concatenates the non-empty groups with a single separator
// between them. Each action is tagged with the owning component's typeId so
// the click handler can route it through `invoke-action`.

import { type Entity } from './Entity';
import { type MenuContext, type MenuItem } from './EntityComponent';
import { componentRegistry } from './ComponentRegistry';

export function aggregateContextMenu(entity: Entity, ctx: MenuContext): MenuItem[] {
  // Spectators (no seat, not host) get an empty menu.
  if (!ctx.isHost && ctx.recipientSeat === null) return [];

  const typeIds = [...entity.components.keys()];
  if (typeIds.length === 0) return [];

  const order = componentRegistry.getSpawnOrder(typeIds);
  const out: MenuItem[] = [];
  for (const cls of order) {
    const comp = entity.components.get(cls.typeId);
    if (!comp) continue;
    const items = comp.onContextMenu(ctx);
    if (items.length === 0) continue;
    if (out.length > 0) out.push({ kind: 'separator' });
    for (const item of items) out.push(tagAction(item, cls.typeId));
  }
  return out;
}

function tagAction(item: MenuItem, componentTypeId: string): MenuItem {
  if (item.kind === 'action') {
    return item.componentTypeId
      ? item
      : { ...item, componentTypeId };
  }
  if (item.kind === 'submenu') {
    return { ...item, items: item.items.map(i => tagAction(i, componentTypeId)) };
  }
  return item;
}
