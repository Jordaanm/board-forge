// Script-facing read surface over the host's SceneImpl. Constructed fresh
// each Run so the EntityFacades it produces are scoped to that Run; once
// #5 lands, listener registrations live on those per-Run wrappers.
//
// `getObjectById` and `getObjectsByTag` lazily wrap raw Entities, caching
// by entity id so a single Run sees a stable identity for any given
// entity (script code can rely on `===` between two lookups).
//
// `playSound(slug)` (issue #11 of issues--asset-registry.md) bounces the
// slug through ScriptRunContext.playSound, which the host wires to
// World.broadcastPlaySound. Unknown / wrong-typed slugs no-op + warn.

import { type EntityScene } from '../entity/EntityComponent';
import { EntityFacade, type ScriptRunContext } from './EntityFacade';
import { type AssetEntry, type AssetType } from '../assets/Manifest';
import { TABLE_ENTITY_ID } from '../entity/tableEntity';

export interface SceneFacadeOptions {
  // Optional asset-slug lookup used to validate `playSound` slugs against
  // the live catalog (base + primitives + host's custom draft). Defaults to
  // no validation — slugs are accepted and pushed through to AssetService,
  // which will resolve to a `broken` status for unknown slugs and the
  // SoundPlayer skips. Wiring the lookup adds an actionable sandbox warning.
  // Also backs `scene.assets.get(slug)` (issue #12).
  lookupSlug?: (slug: string) => AssetEntry | undefined;
  // Backs `scene.assets.list({ type })`. Defaults to `() => []` so scripts
  // running without a wired AssetService see an empty catalog rather than
  // crashing.
  listAssets?: (opts?: { type?: AssetType }) => AssetEntry[];
}

// Read-only catalog surface exposed as `scene.assets`. Returns deeply frozen
// AssetEntry copies so a buggy script can't mutate the host's manifest by
// holding references.
export class AssetsApi {
  private readonly opts: SceneFacadeOptions;

  constructor(opts: SceneFacadeOptions) {
    this.opts = opts;
  }

  get(slug: string): Readonly<AssetEntry> | null {
    if (typeof slug !== 'string' || slug.length === 0) return null;
    const lookup = this.opts.lookupSlug;
    if (!lookup) return null;
    const entry = lookup(slug);
    return entry ? freezeEntry(entry) : null;
  }

  list(opts: { type?: AssetType } = {}): ReadonlyArray<Readonly<AssetEntry>> {
    const list = this.opts.listAssets;
    const raw  = list ? list(opts) : [];
    return Object.freeze(raw.map(freezeEntry));
  }
}

function freezeEntry(entry: AssetEntry): Readonly<AssetEntry> {
  const copy: AssetEntry = {
    slug:    entry.slug,
    name:    entry.name,
    type:    entry.type,
    url:     entry.url,
    preload: entry.preload,
  };
  if (entry.description !== undefined) copy.description = entry.description;
  if (entry.tags !== undefined)        copy.tags = Object.freeze([...entry.tags]) as string[];
  return Object.freeze(copy);
}

export class SceneFacade {
  public readonly assets: AssetsApi;
  private readonly scene: EntityScene;
  private readonly ctx:   ScriptRunContext;
  private readonly opts:  SceneFacadeOptions;
  private readonly cache = new Map<string, EntityFacade>();

  constructor(scene: EntityScene, ctx: ScriptRunContext, opts: SceneFacadeOptions = {}) {
    this.scene  = scene;
    this.ctx    = ctx;
    this.opts   = opts;
    this.assets = new AssetsApi(opts);
  }

  getObjectById(id: string): EntityFacade | undefined {
    const entity = this.scene.getEntity(id);
    if (!entity) return undefined;
    return this.facadeFor(entity.id);
  }

  // One-line wrapper over `getObjectById(TABLE_ENTITY_ID)` so scripts can
  // reach the singleton Table without knowing the magic GUID. Returns
  // undefined only on a guest script context that runs before the Table has
  // replicated, or on an empty scene during legacy-snapshot load.
  getTable(): EntityFacade | undefined {
    return this.getObjectById(TABLE_ENTITY_ID);
  }

  // Returns every entity whose `tags` includes `tag`. Empty array on no match.
  getObjectsByTag(tag: string): EntityFacade[] {
    const out: EntityFacade[] = [];
    for (const entity of this.scene.all()) {
      if (entity.tags.includes(tag)) out.push(this.facadeFor(entity.id));
    }
    return out;
  }

  // Trigger a sound effect on every peer (including the host). Host-only —
  // when no `playSound` callback is wired (guest, or unit tests), the call
  // no-ops with a sandbox warning. Unknown slugs and wrong-type slugs also
  // warn and no-op.
  playSound(slug: string): void {
    if (typeof slug !== 'string' || slug.length === 0) {
      this.warn(`scene.playSound: ignoring invalid slug ${JSON.stringify(slug)}`);
      return;
    }
    if (!this.ctx.playSound) {
      this.warn(`scene.playSound("${slug}"): no-op (host-only API; not running on host)`);
      return;
    }
    const lookup = this.opts.lookupSlug;
    if (lookup) {
      const found = lookup(slug);
      if (!found) {
        this.warn(`scene.playSound("${slug}"): unknown asset slug — no-op`);
        return;
      }
      if (found.type !== 'sound') {
        this.warn(`scene.playSound("${slug}"): asset is type "${found.type}", not "sound" — no-op`);
        return;
      }
    }
    this.ctx.playSound(slug);
  }

  private warn(message: string): void {
    if (this.ctx.warn) { this.ctx.warn(message); return; }
    // Fallback to console.warn so a missing test sink doesn't swallow.
    if (typeof console !== 'undefined') console.warn('[script]', message);
  }

  private facadeFor(id: string): EntityFacade {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const entity = this.scene.getEntity(id);
    if (!entity) throw new Error(`SceneFacade.facadeFor: entity ${id} vanished`);
    const fresh = new EntityFacade(entity, this.ctx);
    this.cache.set(id, fresh);
    return fresh;
  }
}
