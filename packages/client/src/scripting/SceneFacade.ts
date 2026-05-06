// Script-facing read surface over the host's SceneImpl. Constructed fresh
// each Run so the EntityFacades it produces are scoped to that Run; once
// #5 lands, listener registrations live on those per-Run wrappers.
//
// `getObjectById` and `getObjectsByTag` lazily wrap raw Entities, caching
// by entity id so a single Run sees a stable identity for any given
// entity (script code can rely on `===` between two lookups).

import { type EntityScene } from '../entity/EntityComponent';
import { EntityFacade } from './EntityFacade';

export class SceneFacade {
  private readonly scene: EntityScene;
  private readonly cache = new Map<string, EntityFacade>();

  constructor(scene: EntityScene) {
    this.scene = scene;
  }

  getObjectById(id: string): EntityFacade | undefined {
    const entity = this.scene.getEntity(id);
    if (!entity) return undefined;
    return this.facadeFor(entity.id);
  }

  // Returns every entity whose `tags` includes `tag`. Empty array on no match.
  getObjectsByTag(tag: string): EntityFacade[] {
    const out: EntityFacade[] = [];
    for (const entity of this.scene.all()) {
      if (entity.tags.includes(tag)) out.push(this.facadeFor(entity.id));
    }
    return out;
  }

  private facadeFor(id: string): EntityFacade {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const entity = this.scene.getEntity(id);
    if (!entity) throw new Error(`SceneFacade.facadeFor: entity ${id} vanished`);
    const fresh = new EntityFacade(entity);
    this.cache.set(id, fresh);
    return fresh;
  }
}
