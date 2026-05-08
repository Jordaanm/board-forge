// Canonical D20 face map and shared icosahedron geometry. Mirrors the mesh
// baked into MeshComponent.buildD20 and the physics hull built by
// PhysicsComponent.buildShape — change either side and they must move together.
//
// Faces are numbered 1..20 with antipodal pairs summing to 21, the standard
// d20 invariant. Numbering is deterministic from the face order below.

import { type FaceEntry } from './diceFaceResolver';

const PHI = (1 + Math.sqrt(5)) / 2;

// 12 icosahedron vertices on cyclic permutations of (±1, ±φ, 0). Pre-scale —
// they lie on a sphere of radius √(1+φ²); callers scale into world units.
export const D20_VERTICES: ReadonlyArray<readonly [number, number, number]> = [
  [-1,  PHI,  0], [ 1,  PHI,  0], [-1, -PHI,  0], [ 1, -PHI,  0],
  [ 0, -1,  PHI], [ 0,  1,  PHI], [ 0, -1, -PHI], [ 0,  1, -PHI],
  [ PHI,  0, -1], [ PHI,  0,  1], [-PHI,  0, -1], [-PHI,  0,  1],
];

// 20 triangular faces wound counter-clockwise viewed from outside, so
// (b - a) × (c - a) is the outward normal.
export const D20_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [ 0, 11,  5], [ 0,  5,  1], [ 0,  1,  7], [ 0,  7, 10], [ 0, 10, 11],
  [ 1,  5,  9], [ 5, 11,  4], [11, 10,  2], [10,  7,  6], [ 7,  1,  8],
  [ 3,  9,  4], [ 3,  4,  2], [ 3,  2,  6], [ 3,  6,  8], [ 3,  8,  9],
  [ 4,  9,  5], [ 2,  4, 11], [ 6,  2, 10], [ 8,  6,  7], [ 9,  8,  1],
];

export const D20_BOUNDING_SPHERE_RADIUS = Math.sqrt(1 + PHI * PHI);

function faceCentroidUnit(face: readonly [number, number, number]): [number, number, number] {
  const a = D20_VERTICES[face[0]];
  const b = D20_VERTICES[face[1]];
  const c = D20_VERTICES[face[2]];
  const cx = (a[0] + b[0] + c[0]) / 3;
  const cy = (a[1] + b[1] + c[1]) / 3;
  const cz = (a[2] + b[2] + c[2]) / 3;
  const len = Math.hypot(cx, cy, cz);
  return [cx / len, cy / len, cz / len];
}

const NORMALS = D20_FACES.map(faceCentroidUnit);

// Pair faces with their antipode (centroid ≈ -centroid). 10 pairs.
function antipodalPairs(): Array<[number, number]> {
  const seen  = new Set<number>();
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < NORMALS.length; i++) {
    if (seen.has(i)) continue;
    let bestJ = -1;
    let bestScore = -Infinity;
    for (let j = i + 1; j < NORMALS.length; j++) {
      if (seen.has(j)) continue;
      const dot = NORMALS[i][0] * NORMALS[j][0]
                + NORMALS[i][1] * NORMALS[j][1]
                + NORMALS[i][2] * NORMALS[j][2];
      const score = -dot;  // most antipodal wins
      if (score > bestScore) { bestScore = score; bestJ = j; }
    }
    seen.add(i);
    seen.add(bestJ);
    pairs.push([i, bestJ]);
  }
  return pairs;
}

// Pair k (0-indexed) gets values (k+1, 20-k); the lower face index in the pair
// gets the smaller value. All antipodal pairs sum to 21.
function buildFaceMap(): FaceEntry[] {
  const pairs = antipodalPairs();
  const map: FaceEntry[] = new Array(20);
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[k];
    map[a] = { value: k + 1,  upAxis: NORMALS[a] };
    map[b] = { value: 20 - k, upAxis: NORMALS[b] };
  }
  return map;
}

export const D20_FACE_MAP: readonly FaceEntry[] = buildFaceMap();
