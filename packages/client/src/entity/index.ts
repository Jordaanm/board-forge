// Public surface of the entity-component foundation.
// Slice #1 of planning/issues/issues--scene-graph.md.

export { Entity, defaultEntityName } from './Entity';
export type { EntityInit } from './Entity';

export { EntityComponent } from './EntityComponent';
export type {
  ComponentClass,
  ReplicationChannel,
  SpawnContext,
  MenuContext,
  MenuItem,
  CollisionEvent,
  ActionContext,
} from './EntityComponent';

export {
  ComponentRegistry,
  componentRegistry,
  topoSortComponents,
} from './ComponentRegistry';

export { Scene, entityToSerialized } from './Scene';
export type { EntitySerialized } from './Scene';
