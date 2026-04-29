// Process-global Scene singleton. Components do `Scene.getEntity(guid)` for
// ad-hoc cross-entity lookups instead of carrying explicit references.
// Slice #1 of planning/issues/issues--scene-graph.md.

import { Entity } from './Entity';
import { type SpawnContext } from './EntityComponent';
import { componentRegistry, type ComponentRegistry } from './ComponentRegistry';
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
}

// Singleton. Tests can call `Scene.clear()` between runs.
export const Scene = new SceneImpl();

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
