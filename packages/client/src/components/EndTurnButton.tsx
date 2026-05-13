// Top-center HUD button shown only to the peer whose seat is currently
// active. A click sends an `end-turn-request` to the host; the host routes
// the request through `Game.onTurnEndRequested` on the active script (default
// impl advances). See planning/prd--turn-order.md.

import { type RoomStateSnapshot } from '../seats/RoomState';
import { type SeatIndex } from '../seats/SeatLayout';

interface Props {
  snapshot:    RoomStateSnapshot | null;
  selfSeat:    SeatIndex | null;
  onEndTurn:   () => void;
}

const BUTTON: React.CSSProperties = {
  background:   'var(--accent)',
  border:       '1px solid var(--accent-deep)',
  color:        'var(--accent-ink)',
  padding:      '10px 22px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontFamily:   'var(--font-sans)',
  fontSize:     14,
  fontWeight:   700,
  letterSpacing: '0.01em',
  boxShadow:    '0 1px 0 rgba(0,0,0,0.08), 0 2px 0 var(--accent-deep), 0 4px 10px rgba(168,69,31,0.25)',
  userSelect:   'none',
};

export function EndTurnButton({ snapshot, selfSeat, onEndTurn }: Props) {
  if (!snapshot) return null;
  const turns = snapshot.turns;
  if (!turns.enabled) return null;
  if (selfSeat === null) return null;
  if (turns.activeSeat !== selfSeat) return null;

  return (
    <button type="button" style={BUTTON} onClick={onEndTurn}>
      End Turn
    </button>
  );
}
