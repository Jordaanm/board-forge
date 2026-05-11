// Host-only Turn Order panel. Lives in the host action bar (top-center).
// Provides:
//   - Enable / Disable toggle
//   - "End current turn" button (routes through Game.onTurnEndRequested as
//     `endedBy: 'host'` so scripts can still gate the advance)
//   - Jump-to-seat picker (setActive with `endedBy: 'host'`)
//   - Issue #2 (custom order): order editor that adds, removes, and reorders
//     seats in the rotation.
//
// See planning/prd--turn-order.md.

import { useState } from 'react';
import { type RoomStateSnapshot } from '../seats/RoomState';
import { type SeatIndex } from '../seats/SeatLayout';

interface Props {
  snapshot:        RoomStateSnapshot | null;
  onEnable:        () => void;
  onDisable:       () => void;
  onEndCurrent:    () => void;
  onJumpToSeat:    (seat: SeatIndex) => void;
  onSetOrder:      (order: SeatIndex[]) => void;
  open?:           boolean;
  onOpenChange?:   (open: boolean) => void;
  hideTrigger?:    boolean;
}

const PANEL_BUTTON: React.CSSProperties = {
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 12px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     12,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
  userSelect:   'none',
};

const DROPDOWN_BASE: React.CSSProperties = {
  background:   '#1e1e2e',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding:      8,
  minWidth:     260,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.6)',
  zIndex:       200,
  fontFamily:   'sans-serif',
  fontSize:     12,
  color:        '#e8e8e8',
};

const DROPDOWN_ANCHORED: React.CSSProperties = {
  ...DROPDOWN_BASE,
  position: 'absolute',
  top:      'calc(100% + 4px)',
  right:    0,
};

// Used when the trigger button is hidden (panel opened from the Tools menu).
// Centers horizontally just below the top bar so it doesn't pop off-screen
// when the wrapper has zero width.
const DROPDOWN_FLOATING: React.CSSProperties = {
  ...DROPDOWN_BASE,
  position:  'fixed',
  top:       58,
  left:      '50%',
  transform: 'translateX(-50%)',
};

const ROW: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        6,
  marginBottom: 6,
};

const LIST: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  gap:           4,
  marginBottom:  6,
};

const LIST_ITEM: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        6,
  padding:    '2px 4px',
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 4,
};

const ICON_BTN: React.CSSProperties = {
  background:   'rgba(255,255,255,0.08)',
  border:       '1px solid rgba(255,255,255,0.12)',
  color:        '#e8e8e8',
  padding:      '2px 6px',
  borderRadius: 3,
  cursor:       'pointer',
  fontSize:     11,
  fontFamily:   'sans-serif',
};

const ICON_BTN_DISABLED: React.CSSProperties = {
  ...ICON_BTN,
  opacity: 0.4,
  cursor:  'not-allowed',
};

export function TurnControlsPanel({
  snapshot, onEnable, onDisable, onEndCurrent, onJumpToSeat, onSetOrder,
  open: controlledOpen, onOpenChange, hideTrigger,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  if (!snapshot) return null;
  const turns = snapshot.turns;

  return (
    <div style={{ position: 'relative' }}>
      {!hideTrigger && (
        <button
          type="button"
          style={PANEL_BUTTON}
          onClick={() => setOpen(!open)}
        >
          Turn Order{turns.enabled ? ` · seat ${turns.activeSeat ?? '—'}` : ' · off'} ▾
        </button>
      )}
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setOpen(false)}
          />
          <div style={hideTrigger ? DROPDOWN_FLOATING : DROPDOWN_ANCHORED}>
            <div style={ROW}>
              <label>
                <input
                  type="checkbox"
                  checked={turns.enabled}
                  onChange={(e) => e.target.checked ? onEnable() : onDisable()}
                /> Enabled
              </label>
            </div>
            {turns.enabled && (
              <>
                <div style={ROW}>
                  <button
                    type="button"
                    style={PANEL_BUTTON}
                    onClick={onEndCurrent}
                  >
                    End current turn
                  </button>
                </div>
                <JumpToSeatRow snapshot={snapshot} onJump={onJumpToSeat} />
                <OrderEditor snapshot={snapshot} onSetOrder={onSetOrder} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function JumpToSeatRow({
  snapshot, onJump,
}: { snapshot: RoomStateSnapshot; onJump: (seat: SeatIndex) => void }) {
  const occupied = snapshot.seats.filter(s => s.peerId !== null);
  return (
    <div style={ROW}>
      <span style={{ color: '#bdbdc0' }}>Jump to:</span>
      <select
        value=""
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (Number.isFinite(v)) onJump(v as SeatIndex);
        }}
      >
        <option value="">—</option>
        {occupied.map(s => (
          <option key={s.index} value={s.index}>
            Seat {s.index} ({s.colour})
          </option>
        ))}
      </select>
    </div>
  );
}

// Order editor (Issue #2). Lets the host append a seat, remove an entry, or
// move an entry up/down in the rotation. Changes commit through `onSetOrder`
// on every mutation so guests stay in sync.
function OrderEditor({
  snapshot, onSetOrder,
}: { snapshot: RoomStateSnapshot; onSetOrder: (order: SeatIndex[]) => void }) {
  const order = snapshot.turns.order;
  const [addValue, setAddValue] = useState<string>('');

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...order];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onSetOrder(next);
  };

  const moveDown = (idx: number) => {
    if (idx === order.length - 1) return;
    const next = [...order];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onSetOrder(next);
  };

  const remove = (idx: number) => {
    const next = order.filter((_, i) => i !== idx);
    onSetOrder(next);
  };

  const append = () => {
    if (addValue === '') return;
    const v = parseInt(addValue, 10);
    if (!Number.isFinite(v) || v < 0 || v > 7) return;
    onSetOrder([...order, v as SeatIndex]);
    setAddValue('');
  };

  return (
    <div>
      <div style={{ marginBottom: 4, color: '#bdbdc0' }}>Order:</div>
      <div style={LIST}>
        {order.map((seat, idx) => (
          <div key={`${idx}-${seat}`} style={LIST_ITEM}>
            <span style={{ minWidth: 50 }}>Seat {seat}</span>
            <button
              type="button"
              style={idx === 0 ? ICON_BTN_DISABLED : ICON_BTN}
              disabled={idx === 0}
              onClick={() => moveUp(idx)}
            >↑</button>
            <button
              type="button"
              style={idx === order.length - 1 ? ICON_BTN_DISABLED : ICON_BTN}
              disabled={idx === order.length - 1}
              onClick={() => moveDown(idx)}
            >↓</button>
            <button
              type="button"
              style={ICON_BTN}
              onClick={() => remove(idx)}
            >✕</button>
          </div>
        ))}
        {order.length === 0 && (
          <div style={{ color: '#888', fontStyle: 'italic' }}>(empty)</div>
        )}
      </div>
      <div style={ROW}>
        <select
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
        >
          <option value="">+ Add seat…</option>
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <option key={i} value={i}>Seat {i}</option>
          ))}
        </select>
        <button
          type="button"
          style={addValue === '' ? ICON_BTN_DISABLED : ICON_BTN}
          disabled={addValue === ''}
          onClick={append}
        >Add</button>
      </div>
    </div>
  );
}
