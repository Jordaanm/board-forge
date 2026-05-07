// Fixed identity for the singleton Table entity. Constants live here (not in
// scene/Table.ts) so consumers that need only the GUID don't pull in THREE.

// Hand-picked v4-shaped UUID — greppable, parseable as a normal UUID.
export const TABLE_ENTITY_ID = '7ab1e000-0000-4000-8000-000000000001';

// Default world-space half-extents for the Table when its mesh is not yet
// loaded or otherwise indeterminate. Match the rectangle primitive's defaults.
export const DEFAULT_TABLE_HALF_WIDTH = 6;
export const DEFAULT_TABLE_HALF_DEPTH = 4;
