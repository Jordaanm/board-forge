// Process-global Scene singleton. Components do `Scene.getEntity(guid)` for
// ad-hoc cross-entity lookups instead of carrying explicit references.
// Slice #1 of planning/issues/issues--scene-graph.md.

import { Entity, defaultEntityName } from './Entity';
import { type SpawnContext } from './EntityComponent';
import { componentRegistry, type ComponentRegistry } from './ComponentRegistry';
import { getSpawnable } from './SpawnableRegistry';
import { type SeatIndex } from '../seats/SeatLayout';

// Per-entity snapshot — also the save-format leaf (PRD § Save / Load).
export interface EntitySerialized {
  id:            string;
  type:          string;
  name:          string;
  tags:          string[];
  owner:         SeatIndex | null;
  privateToSeat: SeatIndex | null;
  parentId:      string | null;
  children:      string[];
  components:    Record<string, object>;  // typeId → component.toJSON()
}

class SceneImpl {
  private entities = new Map<string, Entity>();
  private registry: ComponentRegistry = componentRegistry;

  getEntity(guid: string): Entity | undefined {
    return this.entities.get(guid);
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  all(): Entity[] {
    return [...this.entities.values()];
  }

  add(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      throw new Error(`Entity already in scene: ${entity.id}`);
    }
    this.entities.set(entity.id, entity);
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  clear(): void {
    this.entities.clear();
  }

  // Test seam: swap the registry that load() consults. Production uses the
  // process-global componentRegistry singleton.
  setRegistry(registry: ComponentRegistry): void {
    this.registry = registry;
  }

  // Two-pass load.
  //   Phase 1: construct each Entity, instantiate its components, call
  //            fromJSON(state). After this pass the scene is fully populated as
  //            data — no view artefacts, no onSpawn.
  //   Phase 2: walk each entity's components in topological order calling
  //            onSpawn(ctx). Cross-entity GUID refs in component state resolve
  //            against the now-populated scene.
  load(snapshots: readonly EntitySerialized[], ctx: SpawnContext): Entity[] {
    const created: Entity[] = [];

    for (const snap of snapshots) {
      const entity = new Entity({
        id:            snap.id,
        type:          snap.type,
        name:          snap.name,
        tags:          snap.tags,
        owner:         snap.owner,
        privateToSeat: snap.privateToSeat,
        parentId:      snap.parentId,
        children:      snap.children,
      });
      for (const [typeId, state] of Object.entries(snap.components)) {
        const cls = this.registry.get(typeId);
        if (!cls) throw new Error(`Unknown component typeId in snapshot: ${typeId}`);
        const comp = new cls();
        comp.fromJSON(state);
        entity.attachComponent(comp);
      }
      this.add(entity);
      created.push(entity);
    }

    for (const entity of created) {
      const typeIds = [...entity.components.keys()];
      const order   = this.registry.getSpawnOrder(typeIds);
      for (const cls of order) {
        const comp = entity.components.get(cls.typeId)!;
        comp.onSpawn(ctx);
      }
    }

    return created;
  }

  // PRD § Spawnables — spawn flow.
  //   1. Look up SpawnableDef by type.
  //   2. Construct Entity with new UUID, type, default tags.
  //   3. Instantiate each component class via registry; call fromJSON(state).
  //   4. Call onSpawn(ctx) per component in topological order.
  spawn(type: string, ctx: SpawnContext, opts: { id?: string } = {}): Entity {
    const def = getSpawnable(type);
    if (!def) throw new Error(`Unknown spawnable type: ${type}`);

    const id = opts.id ?? newGuid();
    const entity = new Entity({
      id,
      type:  def.type,
      name:  defaultEntityName(def.label, id),
      tags:  def.defaultTags,
    });

    for (const init of def.components) {
      const cls = this.registry.get(init.typeId);
      if (!cls) throw new Error(`Spawnable ${type}: unknown component ${init.typeId}`);
      const comp = new cls();
      comp.fromJSON(init.state);
      entity.attachComponent(comp);
    }

    this.add(entity);

    const order = this.registry.getSpawnOrder(def.components.map(c => c.typeId));
    for (const cls of order) {
      entity.components.get(cls.typeId)!.onSpawn(ctx);
    }

    return entity;
  }

  // PRD § Despawn — recursive depth-first descent; reverse-topological
  // onDespawn per entity; remove from scene + parent.children.
  despawn(id: string, ctx: SpawnContext): string[] {
    const removed: string[] = [];
    this.cascadeDespawn(id, ctx, removed);
    return removed;
  }

  private cascadeDespawn(id: string, ctx: SpawnContext, out: string[]): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    for (const childId of [...entity.children]) {
      this.cascadeDespawn(childId, ctx, out);
    }
    const typeIds = [...entity.components.keys()];
    const order   = this.registry.getSpawnOrder(typeIds);
    for (let i = order.length - 1; i >= 0; i--) {
      entity.components.get(order[i].typeId)!.onDespawn(ctx);
    }
    if (entity.parentId) {
      const parent = this.entities.get(entity.parentId);
      if (parent) parent.children = parent.children.filter(c => c !== id);
    }
    this.entities.delete(id);
    out.push(id);
  }
}

function newGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes (test envs without crypto.randomUUID).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Singleton. Tests can call `Scene.clear()` between runs.
export const Scene = new SceneImpl();

// Resolve a THREE.Object3D hit (typically from a raycast) back to its owning
// entity by walking up the parent chain to find an object that matches some
// entity's TransformComponent.object3d. Returns undefined if the hit isn't
// rooted in an entity tree.
export function findEntityByObject3D(hit: import('three').Object3D): Entity | undefined {
  let obj: import('three').Object3D | null = hit;
  while (obj) {
    for (const entity of Scene.all()) {
      const t = entity.components.get('transform') as { object3d?: import('three').Object3D } | undefined;
      if (t?.object3d === obj) return entity;
    }
    obj = obj.parent;
  }
  return undefined;
}

// Walk an entity to its serialised snapshot. Mirrors the load() input shape so
// the round-trip is symmetric.
export function entityToSerialized(e: Entity): EntitySerialized {
  const components: Record<string, object> = {};
  for (const [typeId, comp] of e.components) {
    components[typeId] = comp.toJSON();
  }
  return {
    id:            e.id,
    type:          e.type,
    name:          e.name,
    tags:          [...e.tags],
    owner:         e.owner,
    privateToSeat: e.privateToSeat,
    parentId:      e.parentId,
    children:      [...e.children],
    components,
  };
}
