// Marker base class scripts extend. Hooks default to no-op so authors who
// only override one of them don't need to stub the others. Constructed once
// per Run. Real `scene` typing lands in #4; for #1 the hook receives whatever
// the Compartment's `scene` global currently is.
//
// Turn-tracker hooks (planning/prd--turn-order.md): `onTurnStart` and
// `onTurnEnd` fire when the engine's TurnTracker emits the corresponding
// events. `onTurnEndRequested` is the gate the active player's End Turn
// button (and host's "End current turn") routes through — the default
// implementation delegates to `scene.turns.next()`; scripts that need to
// gate end-of-turn (e.g. "must roll the die first") override and decide
// whether to advance.

import { type SeatIndex } from '../seats/SeatLayout';
import { type EndedBy } from '../seats/RoomStateManager';

interface TurnsApi {
  next(): void;
}

interface SceneWithTurns {
  turns: TurnsApi;
}

export class Game {
  onSceneInitialised(_scene: unknown): void {}
  onScriptLoaded(_scene: unknown): void {}

  onTurnStart(_seat: SeatIndex, _turnNumber: number): void {}
  onTurnEnd(_seat: SeatIndex, _turnNumber: number, _endedBy: EndedBy): void {}

  // Default implementation: advance immediately. Scripts override to gate
  // end-of-turn on game rules. The host routes both the active player's
  // End Turn button and its own "End current turn" panel button through
  // this hook on the active Game instance.
  onTurnEndRequested(_seat: SeatIndex): void {
    const scene = (this as unknown as { scene?: SceneWithTurns; ['__scene']?: SceneWithTurns });
    const candidate = scene.scene ?? scene['__scene'];
    if (candidate?.turns?.next) candidate.turns.next();
  }
}
