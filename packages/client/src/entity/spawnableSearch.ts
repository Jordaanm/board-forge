// Pure filter / group / rank helpers for the spawn modal. Kept free of React
// so the rules can be unit-tested in isolation. The modal calls these from
// render; updates land when listSpawnables() returns more entries (e.g. once
// scripting registers spawnables at runtime).

import { type SpawnableDef } from './SpawnableRegistry';

export interface CategoryGroup {
  category: string;
  items:    SpawnableDef[];
}

// Groups defs by category. Category order follows first-appearance in `defs`
// (i.e. registration order). Items within each group are sorted alphabetically
// by label.
export function groupByCategory(defs: SpawnableDef[]): CategoryGroup[] {
  const order:   string[] = [];
  const buckets = new Map<string, SpawnableDef[]>();
  for (const def of defs) {
    let bucket = buckets.get(def.category);
    if (!bucket) {
      bucket = [];
      buckets.set(def.category, bucket);
      order.push(def.category);
    }
    bucket.push(def);
  }
  return order.map(category => ({
    category,
    items: buckets.get(category)!.slice().sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

const TIER_PREFIX    = 0;
const TIER_SUBSTRING = 1;
const TIER_META      = 2;
const TIER_NONE      = 3;

function tierFor(def: SpawnableDef, q: string): number {
  const label = def.label.toLowerCase();
  if (label.startsWith(q)) return TIER_PREFIX;
  if (label.includes(q))   return TIER_SUBSTRING;
  if (def.category.toLowerCase().includes(q)) return TIER_META;
  if (def.type.toLowerCase().includes(q))     return TIER_META;
  if (def.defaultTags.some(t => t.toLowerCase().includes(q))) return TIER_META;
  return TIER_NONE;
}

// Returns a flat ranked list. Tiers (highest first): label-prefix,
// label-substring, then any of category/type/defaultTags substring. Within a
// tier, ties break alphabetically by label. Empty / whitespace-only query
// returns the input unchanged.
export function searchSpawnables(defs: SpawnableDef[], query: string): SpawnableDef[] {
  const q = query.trim().toLowerCase();
  if (q === '') return defs;
  return defs
    .map(def => ({ def, tier: tierFor(def, q) }))
    .filter(r => r.tier !== TIER_NONE)
    .sort((a, b) => a.tier - b.tier || a.def.label.localeCompare(b.def.label))
    .map(r => r.def);
}
