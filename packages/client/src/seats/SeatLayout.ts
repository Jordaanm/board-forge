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

// Canonical table dimensions — mirror packages/client/src/scene/Table.ts.
// Duplicated here to keep this module pure (Table.ts pulls in THREE).
const TABLE_WIDTH  = 12;
const TABLE_DEPTH  = 8;
const TABLE_RADIUS = Math.min(TABLE_WIDTH, TABLE_DEPTH) / 2;

// Rectangle: 3-3-1-1 walking CCW (viewed from above) starting at front-right.
// Front (+Z) seats face -Z, left (-X) faces +X, back (-Z) faces +Z, right (+X) faces -X.
const RECT_LAYOUT: readonly SeatPose[] = [
  { position: { x:  TABLE_WIDTH / 4, y: 0, z:  TABLE_DEPTH / 2 }, facing: { x:  0, y: 0, z: -1 } },
  { position: { x:  0,               y: 0, z:  TABLE_DEPTH / 2 }, facing: { x:  0, y: 0, z: -1 } },
  { position: { x: -TABLE_WIDTH / 4, y: 0, z:  TABLE_DEPTH / 2 }, facing: { x:  0, y: 0, z: -1 } },
  { position: { x: -TABLE_WIDTH / 2, y: 0, z:  0               }, facing: { x:  1, y: 0, z:  0 } },
  { position: { x: -TABLE_WIDTH / 4, y: 0, z: -TABLE_DEPTH / 2 }, facing: { x:  0, y: 0, z:  1 } },
  { position: { x:  0,               y: 0, z: -TABLE_DEPTH / 2 }, facing: { x:  0, y: 0, z:  1 } },
  { position: { x:  TABLE_WIDTH / 4, y: 0, z: -TABLE_DEPTH / 2 }, facing: { x:  0, y: 0, z:  1 } },
  { position: { x:  TABLE_WIDTH / 2, y: 0, z:  0               }, facing: { x: -1, y: 0, z:  0 } },
];

// Circle: 8 evenly spaced at 45°. Seat 0 at +Z (closest to default camera), CCW viewed from above.
function circleSeat(i: SeatIndex): SeatPose {
  const angle = (i * Math.PI) / 4;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return {
    position: { x: -TABLE_RADIUS * s, y: 0, z:  TABLE_RADIUS * c },
    facing:   { x:               s,  y: 0, z:              -c },
  };
}

export function getSeatLayout(tableShape: TableShape, seatIndex: SeatIndex): SeatPose {
  if (tableShape === 'rectangle') return RECT_LAYOUT[seatIndex];
  return circleSeat(seatIndex);
}
