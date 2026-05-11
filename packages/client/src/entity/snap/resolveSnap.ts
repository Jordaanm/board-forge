// Pure snap-decision algorithm. No I/O, no THREE, no scene access.
// Caller resolves each candidate snap point to world coords and supplies them
// here; this module just picks the winner (if any) by XZ distance and applies
// the self/descendant exclusions.
//
// Issue #1 of planning/issues--snap.md. Consumed by GrabTool integration in #3.

export interface SnapCandidate {
  ownerEntityId: string;
  worldPos:      [number, number, number];
  worldYaw:      number;
  snapRotation:  boolean;
  radius:        number;
}

export interface SnapInput {
  droppedXZ:       [number, number];
  droppedEntityId: string;
  descendantIds:   Set<string>;
  candidates:      SnapCandidate[];
}

export interface SnapResult {
  targetPos:    [number, number, number];
  targetYaw:    number;
  snapRotation: boolean;
}

export function resolveSnap(input: SnapInput): SnapResult | null {
  const [dx, dz] = input.droppedXZ;
  let best: SnapCandidate | null = null;
  let bestSq = Infinity;

  for (const c of input.candidates) {
    if (c.ownerEntityId === input.droppedEntityId) continue;
    if (input.descendantIds.has(c.ownerEntityId)) continue;

    const ddx = c.worldPos[0] - dx;
    const ddz = c.worldPos[2] - dz;
    const distSq = ddx * ddx + ddz * ddz;
    if (distSq > c.radius * c.radius) continue;

    // Strict < keeps tie-breaking deterministic on input order.
    if (distSq < bestSq) {
      bestSq = distSq;
      best = c;
    }
  }

  if (!best) return null;
  return {
    targetPos:    [best.worldPos[0], best.worldPos[1], best.worldPos[2]],
    targetYaw:    best.worldYaw,
    snapRotation: best.snapRotation,
  };
}
