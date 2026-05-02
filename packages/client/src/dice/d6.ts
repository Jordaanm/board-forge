// Canonical D6 face map. Mirrors the pip placements baked into
// MeshComponent.buildD6 — change either side and they must move together.

import { type FaceEntry } from './diceFaceResolver';

export const D6_FACE_MAP: readonly FaceEntry[] = [
  { value: 1, upAxis: [ 0,  1,  0] },
  { value: 6, upAxis: [ 0, -1,  0] },
  { value: 2, upAxis: [ 0,  0,  1] },
  { value: 5, upAxis: [ 0,  0, -1] },
  { value: 3, upAxis: [ 1,  0,  0] },
  { value: 4, upAxis: [-1,  0,  0] },
];
