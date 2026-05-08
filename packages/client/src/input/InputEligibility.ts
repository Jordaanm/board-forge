// Pure eligibility filter for entity-input events (issue #1 of issues--interaction.md).
//
// An entity is eligible to receive `pressed` / `released` / `click` /
// `hover-start` / `hover-end` iff:
//   - it is not contained inside another entity (`isContained === false`)
//   - it does NOT have a TableComponent
//   - its `privateToSeat` is unset, or matches the viewer's seat
//
// Kept in its own module so the rule has a single, exhaustively-unit-tested
// home. Both `InputDispatcher` (3D raycast) and `HandPanel` (FlatView tile
// dispatch) consult it.

import { type Entity } from '../entity/Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { TableComponent } from '../entity/components/TableComponent';

export function isEligibleForInput(entity: Entity, viewerSeat: SeatIndex | null): boolean {
  if (entity.isContained) return false;
  if (entity.hasComponent(TableComponent)) return false;
  if (entity.privateToSeat !== null && entity.privateToSeat !== viewerSeat) return false;
  return true;
}
