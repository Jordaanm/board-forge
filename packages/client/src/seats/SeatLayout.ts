// Pure seat data + layout resolver. No THREE / CANNON / DOM imports.
// Foundational module for prd--seats-MVP — referenced by RoomState, OwnershipPolicy,
// and (future) PRD-2 Hands.

export type SeatIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const SEAT_COLOURS = [
  'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink',
] as const;

export type SeatColour = typeof SEAT_COLOURS[number];

export type TableShape = 'rectangle' | 'circle';

export interface Vec3   { x: number; y: number; z: number; }
export interface SeatPose { position: Vec3; facing: Vec3; }

// Seat layout from rectangle table half-extents. 8 seats walking CCW (viewed
// from above) starting at front-right: 3 across the +Z edge, 1 on -X, 3
// across the -Z edge, 1 on +X. Frozen at room boot from the current Table
// bounds; live mid-session reseating on table rescale is intentionally out
// of scope.
export function computeSeatLayout(bounds: { halfWidth: number; halfDepth: number }): SeatPose[] {
  const hx = bounds.halfWidth;
  const hz = bounds.halfDepth;
  return [
    { position: { x:  hx / 2, y: 0, z:  hz     }, facing: { x:  0, y: 0, z: -1 } },
    { position: { x:  0,      y: 0, z:  hz     }, facing: { x:  0, y: 0, z: -1 } },
    { position: { x: -hx / 2, y: 0, z:  hz     }, facing: { x:  0, y: 0, z: -1 } },
    { position: { x: -hx,     y: 0, z:  0      }, facing: { x:  1, y: 0, z:  0 } },
    { position: { x: -hx / 2, y: 0, z: -hz     }, facing: { x:  0, y: 0, z:  1 } },
    { position: { x:  0,      y: 0, z: -hz     }, facing: { x:  0, y: 0, z:  1 } },
    { position: { x:  hx / 2, y: 0, z: -hz     }, facing: { x:  0, y: 0, z:  1 } },
    { position: { x:  hx,     y: 0, z:  0      }, facing: { x: -1, y: 0, z:  0 } },
  ];
}

// Circle: 8 evenly spaced at 45°. Seat 0 at +Z (closest to default camera), CCW viewed from above.
function circleSeat(i: SeatIndex, radius: number): SeatPose {
  const angle = (i * Math.PI) / 4;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return {
    position: { x: -radius * s, y: 0, z:  radius * c },
    facing:   { x:           s, y: 0, z:          -c },
  };
}

// Default rect bounds — match the legacy `prim:table-rect` defaults so callers
// that haven't migrated to the bounds-aware path keep producing identical seat
// positions.
const DEFAULT_HALF_WIDTH = 6;
const DEFAULT_HALF_DEPTH = 4;
const DEFAULT_RADIUS     = Math.min(DEFAULT_HALF_WIDTH, DEFAULT_HALF_DEPTH);

export function getSeatLayout(tableShape: TableShape, seatIndex: SeatIndex): SeatPose {
  if (tableShape === 'rectangle') {
    return computeSeatLayout({ halfWidth: DEFAULT_HALF_WIDTH, halfDepth: DEFAULT_HALF_DEPTH })[seatIndex];
  }
  return circleSeat(seatIndex, DEFAULT_RADIUS);
}
