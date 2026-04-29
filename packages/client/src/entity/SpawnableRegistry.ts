// Spawnable definitions for the v2 entity-component scene graph.
// Slice #3 of planning/issues/issues--scene-graph.md.
//
// Pure-data definitions — instantiated by Scene.spawn().

import { componentRegistry } from './ComponentRegistry';

export interface ComponentInit {
  typeId: string;
  state:  Record<string, unknown>;
}

export interface SpawnableDef {
  type:        string;
  label:       string;
  defaultTags: string[];
  components:  ComponentInit[];
}

const SPAWNABLES = new Map<string, SpawnableDef>();

// Registers a spawnable. Validates that every component class it lists is
// known to the registry and that each component's `static requires` are
// satisfied within the def's component list (per PRD § Spawnables).
export function registerSpawnable(def: SpawnableDef): void {
  if (SPAWNABLES.has(def.type)) {
    throw new Error(`Spawnable already registered: ${def.type}`);
  }
  const present = new Set(def.components.map(c => c.typeId));
  for (const c of def.components) {
    const cls = componentRegistry.get(c.typeId);
    if (!cls) throw new Error(`Spawnable ${def.type}: unknown component typeId ${c.typeId}`);
    for (const req of cls.requires) {
      if (!present.has(req)) {
        throw new Error(
          `Spawnable ${def.type}: component ${c.typeId} requires ${req}, not present in def`,
        );
      }
    }
  }
  SPAWNABLES.set(def.type, def);
}

export function getSpawnable(type: string): SpawnableDef | undefined {
  return SPAWNABLES.get(type);
}

export function listSpawnables(): SpawnableDef[] {
  return [...SPAWNABLES.values()];
}

export function clearSpawnables(): void {
  SPAWNABLES.clear();
}
