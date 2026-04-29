// Registry of component classes keyed by `static typeId`, plus a topological
// sort utility for resolving `static requires` ordering. Slice #1 of
// planning/issues/issues--scene-graph.md.

import { type ComponentClass } from './EntityComponent';

export class ComponentRegistry {
  private readonly classes    = new Map<string, ComponentClass>();
  private readonly orderCache = new Map<string, ComponentClass[]>();

  register(cls: ComponentClass): void {
    if (!cls.typeId) {
      throw new Error('Component class missing static typeId');
    }
    if (this.classes.has(cls.typeId)) {
      throw new Error(`Component typeId already registered: ${cls.typeId}`);
    }
    for (const req of cls.requires) {
      if (!this.classes.has(req)) {
        throw new Error(`Component ${cls.typeId} requires unknown typeId: ${req}`);
      }
    }
    this.classes.set(cls.typeId, cls);
  }

  get(typeId: string): ComponentClass | undefined {
    return this.classes.get(typeId);
  }

  has(typeId: string): boolean {
    return this.classes.has(typeId);
  }

  // Returns the component classes for the given typeIds in topological onSpawn
  // order. Reverse this list for onDespawn order. Cached per sorted-typeId set.
  getSpawnOrder(typeIds: readonly string[]): ComponentClass[] {
    const cacheKey = [...typeIds].sort().join('|');
    const cached = this.orderCache.get(cacheKey);
    if (cached) return cached;

    const classes: ComponentClass[] = [];
    for (const id of typeIds) {
      const cls = this.classes.get(id);
      if (!cls) throw new Error(`Unknown component typeId: ${id}`);
      classes.push(cls);
    }
    const sorted = topoSortComponents(classes);
    this.orderCache.set(cacheKey, sorted);
    return sorted;
  }

  clear(): void {
    this.classes.clear();
    this.orderCache.clear();
  }
}

// Process-global singleton used by Scene + spawnable definitions.
export const componentRegistry = new ComponentRegistry();

// Topological sort over a closed set of component classes. Each `requires`
// entry must reference a typeId present in the input set. Cycles throw.
export function topoSortComponents(classes: readonly ComponentClass[]): ComponentClass[] {
  const byId = new Map<string, ComponentClass>();
  for (const cls of classes) byId.set(cls.typeId, cls);

  const result:   ComponentClass[] = [];
  const visited:  Set<string>      = new Set();
  const visiting: Set<string>      = new Set();

  function visit(cls: ComponentClass): void {
    if (visited.has(cls.typeId))  return;
    if (visiting.has(cls.typeId)) {
      throw new Error(`Component dependency cycle involving: ${cls.typeId}`);
    }
    visiting.add(cls.typeId);
    for (const reqId of cls.requires) {
      const req = byId.get(reqId);
      if (!req) {
        throw new Error(`Component ${cls.typeId} requires missing typeId: ${reqId}`);
      }
      visit(req);
    }
    visiting.delete(cls.typeId);
    visited.add(cls.typeId);
    result.push(cls);
  }

  for (const cls of classes) visit(cls);
  return result;
}
