// Wiring seam between `SceneFacade.turns` (script-facing) and the host's
// `RoomStateManager`. The bridge is host-only: its `dispatch` routes a
// `TurnAction` through the manager's reducer; `getState` reads the
// authoritative TurnState.
//
// Guest scripts construct a SceneFacade without `opts.turns`, so the
// TurnsApi falls back to warn-and-no-op for mutations. (Reads are also
// scoped to host because guests don't currently run scripts.)

import { type TurnAction, type TurnState } from '../seats/TurnTracker';

export interface TurnsBridge {
  dispatch(action: TurnAction): void;
  getState(): TurnState;
}
