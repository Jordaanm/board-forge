// Marker component for the singleton Table entity. Carries no replicated
// state; its presence on an entity discriminates the Table from every other
// scene entity. Locking enforcement (no-despawn / no-spawn-duplicate / no-
// drag / no-gizmo / no-delete) keys on `entity.hasComponent(TableComponent)`
// rather than on a magic GUID check, so future fixture-class entities can
// reuse the pattern.

import { EntityComponent, type SpawnContext } from '../EntityComponent';

export interface TableState {}

export class TableComponent extends EntityComponent<TableState> {
  static typeId = 'table';

  onSpawn(_ctx: SpawnContext): void {}
  onPropertiesChanged(_changed: Partial<TableState>): void {}
}
