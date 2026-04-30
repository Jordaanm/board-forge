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

export { Scene, entityToSerialized, findEntityByObject3D } from './Scene';
export type { EntitySerialized } from './Scene';

export type {
  ComponentPatch,
  ComponentPatchesMessage,
  EntityPatch,
  EntityFieldsPartial,
  EntitySpawn,
  DespawnBatch,
  InvokeAction,
  HoldClaim,
  HoldRelease,
  RequestUpdate,
  SceneMessage,
} from './wire';

export { HostReplicatorV2 } from './HostReplicatorV2';
export { applySceneMessage } from './GuestReceiver';
export type { GuestReceiveContext } from './GuestReceiver';
export { HoldService } from './HoldService';
export type { ReleaseVelocity } from './HoldService';
export { HostInputDispatcher } from './HostInputDispatcher';
export { aggregateContextMenu } from './contextMenu';

export { TransformComponent } from './components/TransformComponent';
export type { TransformState } from './components/TransformComponent';

export { MeshComponent } from './components/MeshComponent';
export type { MeshState, MeshSize } from './components/MeshComponent';

export { PhysicsComponent } from './components/PhysicsComponent';
export type { PhysicsState, Vec3Like } from './components/PhysicsComponent';

export { ValueComponent } from './components/ValueComponent';
export type { ValueState } from './components/ValueComponent';

export {
  registerSpawnable,
  getSpawnable,
  listSpawnables,
  clearSpawnables,
} from './SpawnableRegistry';
export type { SpawnableDef, ComponentInit } from './SpawnableRegistry';

export { registerCorePrimitives } from './spawnables';
export { SceneSystemV2 } from './SceneSystemV2';
