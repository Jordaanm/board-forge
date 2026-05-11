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
  background:   'rgba(40,140,80,0.92)',
  border:       '1px solid rgba(255,255,255,0.35)',
  color:        '#ffffff',
  padding:      '10px 22px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     14,
  fontWeight:   600,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
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
