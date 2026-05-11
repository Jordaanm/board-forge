# Player Turn Tracker

Tracks which Seat's turn it is, following a configurable order. Per-game enable, scripting-accessible, fires events on turn transitions.

## State

Room-level, host-authoritative, replicated via existing `RoomStateManager` / `RoomStateClient` plumbing. Persisted in save/load.

```ts
type TurnState = {
  enabled: boolean;
  order: SeatIndex[];          // default [0..7]
  activeSeat: SeatIndex | null;
  turnNumber: number;          // increments on each turn-start; resets only on enable
};
```

## Mutations

All mutations originate on host (script or host UI). Replicated to guests.

| Mutation | Behavior |
|---|---|
| `enable(order?)` | Auto-picks first occupied seat in order, fires `turn-start`. Idle (`activeSeat = null`) if none occupied. |
| `disable()` | Fires `turn-end` if active, clears state. |
| `next()` | Advances to next occupied seat in order. Wraps to `order[0]` if current is off-order. Sets `activeSeat = null` if no occupied seats in order. |
| `setActive(seat)` | Fires `turn-end` + `turn-start`. No-op if same seat. |
| `setOrder(seats)` | Replaces order. Duplicates allowed. Out-of-layout indices silently filtered at advance-time. |

### Order semantics

- `order: SeatIndex[]` — opaque list, may contain duplicates.
- Only **occupied** seats count. Empty seats in the order are skipped at advance-time.
- Default order on `enable()` with no arg: `[0, 1, 2, 3, 4, 5, 6, 7]`. New sitters mid-game auto-join the rotation.
- No auto-reaction to vacancy mid-turn — host has manual tools (`setActive`, `next`, `setOrder`) to resolve.

## End-turn flow

Active player's button sends an **end-turn request** to host (not a direct mutation). Host calls `Game.onTurnEndRequested(seat)`.

```ts
class Game {
  onTurnEndRequested(seat: SeatIndex) {
    this.scene.turns.next(); // default: auto-advance
  }
}
```

Scripts override to gate (e.g. "must roll first"). Player can always leave by standing up. Same flow used by the host's "end turn" control.

Matches the existing principle: **tools express intent, components decide effect.**

## Events

Game lifecycle hooks, host-only (consistent with `onSceneInitialised` / `onScriptLoaded`):

```ts
class Game {
  onTurnStart(seat: SeatIndex, turnNumber: number) {}
  onTurnEnd(seat: SeatIndex, turnNumber: number, endedBy: 'player' | 'host' | 'script') {}
  onTurnEndRequested(seat: SeatIndex) {}
}
```

Firing rules:

| Event | Fires on |
|---|---|
| `turn-start` | `enable()` (if active resolves), `next()`, `setActive()` |
| `turn-end` | `disable()`, `next()`, `setActive()` |

**Silent** on: active seat vacancy, save/load hydration. Scripts that need to rehydrate read `scene.turns.getActive()` in `onScriptLoaded`.

Fire order on transition: `turn-end` (outgoing) → `turn-start` (incoming).

## UI

- **Active player only**: "End Turn" button, top-center HUD. Single click, no confirmation, no hotkey.
- **All peers**: decoration next to active seat's entry in `PlayersPanel` (top-right list). Renders only when `enabled`.
- **Host**: turn-tracker controls in host panel — enable/disable, end turn, jump to seat, edit order. Not in always-visible HUD.

## Scripting API

Exposed on `SceneFacade.turns`:

```ts
scene.turns.enable(order?: SeatIndex[]): void;
scene.turns.disable(): void;
scene.turns.next(): void;
scene.turns.setActive(seat: SeatIndex): void;
scene.turns.setOrder(order: SeatIndex[]): void;

scene.turns.isEnabled(): boolean;
scene.turns.getActive(): SeatIndex | null;
scene.turns.getOrder(): SeatIndex[];
scene.turns.getTurnNumber(): number;
```

## Persistence

- **Save/load**: all four state fields hydrate silently. No `turn-start` / `turn-end` fires on load.
- **Script reload**: state survives. Script reads `scene.turns.getActive()` in `onScriptLoaded` if it needs to rehydrate UI.

## Out of scope

- Turn timers (auto-advance after N seconds). Scripts can implement via `scene.scheduleAfter` + `turns.next()`.
- Separate `roundNumber`. Scripts compute from `turnNumber` if needed.
- Engine-provided "whose turn is it" indicators beyond the PlayersPanel decoration.
