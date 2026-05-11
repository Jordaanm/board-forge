import { useState } from 'react';
import { type RoomStateSnapshot, type SeatEntry } from '../seats/RoomState';
import { type SeatIndex } from '../seats/SeatLayout';
import { useFlipPosition } from './useFlipPosition';
import './PlayersPanel.css';

interface Props {
  snapshot:    RoomStateSnapshot | null;
  selfPeerId:  string | null;
  isHost:      boolean;
  onClaimSeat: (seatIndex: SeatIndex) => void;
  onKick:      (peerId: string) => void;
  onBan:       (peerId: string) => void;
}

interface MenuState {
  x:         number;
  y:         number;
  rowKind:   'seat' | 'spectator';
  seat?:     SeatEntry;          // present for seat rows (empty or occupied)
  peerId:    string | null;      // occupant peerId, null for empty seat
}

export function PlayersPanel({
  snapshot, selfPeerId, isHost, onClaimSeat, onKick, onBan,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu]           = useState<MenuState | null>(null);

  if (!snapshot) return null;

  const totalPeers = snapshot.seats.filter(s => s.peerId !== null).length + snapshot.spectators.length;

  const openMenu = (e: React.MouseEvent, partial: Omit<MenuState, 'x' | 'y'>) => {
    e.preventDefault();
    if (!hasMenuActions(partial, snapshot, selfPeerId, isHost)) return;
    setMenu({ x: e.clientX, y: e.clientY, ...partial });
  };

  return (
    <>
      <div className={`players-panel${collapsed ? ' players-panel--collapsed' : ''}`}>
        <div className="players-panel__header" onClick={() => setCollapsed(c => !c)}>
          <span className="players-panel__title">Players ({totalPeers})</span>
          <span className="players-panel__chevron">{collapsed ? '▸' : '▾'}</span>
        </div>

        {!collapsed && (
          <div className="players-panel__list">
            {snapshot.seats.map(seat => (
              <SeatRow
                key={`seat-${seat.index}`}
                seat={seat}
                isSelf={seat.peerId !== null && seat.peerId === selfPeerId}
                isHostPeer={seat.peerId === snapshot.hostPeerId}
                isActiveTurn={snapshot.turns.enabled && snapshot.turns.activeSeat === seat.index}
                onContextMenu={(e) => openMenu(e, {
                  rowKind: 'seat', seat, peerId: seat.peerId,
                })}
              />
            ))}

            {snapshot.spectators.length > 0 && (
              <div className="players-panel__section-label">Spectators</div>
            )}
            {snapshot.spectators.map(peerId => (
              <SpectatorRow
                key={`spec-${peerId}`}
                peerId={peerId}
                isSelf={peerId === selfPeerId}
                onContextMenu={(e) => openMenu(e, {
                  rowKind: 'spectator', peerId,
                })}
              />
            ))}
          </div>
        )}
      </div>

      {menu && (
        <PlayerMenu
          state={menu}
          snapshot={snapshot}
          selfPeerId={selfPeerId}
          isHost={isHost}
          onClaimSeat={(idx) => { onClaimSeat(idx); setMenu(null); }}
          onKick={(id) => { onKick(id); setMenu(null); }}
          onBan={(id) => { onBan(id); setMenu(null); }}
          onDismiss={() => setMenu(null)}
        />
      )}
    </>
  );
}

function SeatRow({
  seat, isSelf, isHostPeer, isActiveTurn, onContextMenu,
}: {
  seat:          SeatEntry;
  isSelf:        boolean;
  isHostPeer:    boolean;
  isActiveTurn:  boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const occupied = seat.peerId !== null;
  return (
    <div
      className={`players-panel__row${isSelf ? ' players-panel__row--self' : ''}`}
      onContextMenu={onContextMenu}
    >
      {isActiveTurn && (
        <span
          className="players-panel__turn-indicator"
          title="Active turn"
        >▶</span>
      )}
      <div
        className={`players-panel__swatch${occupied ? '' : ' players-panel__swatch--empty'}`}
        style={{ background: occupied ? seat.colour : undefined }}
        title={`Seat ${seat.index} (${seat.colour})`}
      />
      {occupied
        ? <span className="players-panel__name">{seat.peerId}</span>
        : <span className="players-panel__name players-panel__name--placeholder">empty</span>}
      {isHostPeer && <span className="players-panel__badge players-panel__badge--host">host</span>}
      {isSelf && !isHostPeer && <span className="players-panel__badge">you</span>}
    </div>
  );
}

function SpectatorRow({
  peerId, isSelf, onContextMenu,
}: {
  peerId:        string;
  isSelf:        boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`players-panel__row${isSelf ? ' players-panel__row--self' : ''}`}
      onContextMenu={onContextMenu}
    >
      <div className="players-panel__swatch players-panel__swatch--empty" />
      <span className="players-panel__name">{peerId}</span>
      {isSelf && <span className="players-panel__badge">you</span>}
    </div>
  );
}

const MENU_STYLE: React.CSSProperties = {
  position: 'fixed', zIndex: 201,
  background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6, padding: '4px 0', minWidth: 160,
  boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
};

const MENU_HEADER: React.CSSProperties = {
  padding: '8px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  userSelect: 'none',
  fontFamily: 'sans-serif',
};

const MENU_ITEM: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 16px',
  background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', fontSize: 13, fontFamily: 'sans-serif', color: '#e8e8e8',
};

const SEPARATOR: React.CSSProperties = {
  height: 1, margin: '4px 0', background: 'rgba(255,255,255,0.1)',
};

function menuFlags(
  state:      Pick<MenuState, 'rowKind' | 'seat' | 'peerId'>,
  snapshot:   RoomStateSnapshot,
  selfPeerId: string | null,
  isHost:     boolean,
) {
  const isOwnRow     = state.peerId !== null && state.peerId === selfPeerId;
  const isEmptySeat  = state.rowKind === 'seat' && state.peerId === null;
  const targetIsHost = state.peerId !== null && state.peerId === snapshot.hostPeerId;
  const showSit      = isEmptySeat && selfPeerId !== null;
  const emptySeats   = snapshot.seats.filter(s =>
    s.peerId === null && (state.rowKind !== 'seat' || s.index !== state.seat?.index),
  );
  const showMoveSubmenu = isOwnRow && emptySeats.length > 0;
  const showKickBan     = isHost && !isOwnRow && state.peerId !== null && !targetIsHost;
  return { showSit, showMoveSubmenu, showKickBan, emptySeats };
}

function hasMenuActions(
  state:      Pick<MenuState, 'rowKind' | 'seat' | 'peerId'>,
  snapshot:   RoomStateSnapshot,
  selfPeerId: string | null,
  isHost:     boolean,
): boolean {
  const f = menuFlags(state, snapshot, selfPeerId, isHost);
  return f.showSit || f.showMoveSubmenu || f.showKickBan;
}

function PlayerMenu({
  state, snapshot, selfPeerId, isHost,
  onClaimSeat, onKick, onBan, onDismiss,
}: {
  state:        MenuState;
  snapshot:     RoomStateSnapshot;
  selfPeerId:   string | null;
  isHost:       boolean;
  onClaimSeat:  (seatIndex: SeatIndex) => void;
  onKick:       (peerId: string) => void;
  onBan:        (peerId: string) => void;
  onDismiss:    () => void;
}) {
  const { showSit, showMoveSubmenu, showKickBan, emptySeats } = menuFlags(
    state, snapshot, selfPeerId, isHost,
  );
  const headerLabel = state.peerId
    ? state.peerId
    : `Seat ${state.seat?.index} (${state.seat?.colour ?? ''})`;

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 200 }}
        onClick={onDismiss}
        onContextMenu={(e) => { e.preventDefault(); onDismiss(); }}
      />
      <div role="menu" style={{ ...MENU_STYLE, left: state.x, top: state.y }}>
        <div style={MENU_HEADER}>
          <div style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
            {headerLabel}
          </div>
        </div>

        {showSit && state.seat && (
          <MenuItemBtn
            label="Sit here"
            onClick={() => onClaimSeat(state.seat!.index)}
          />
        )}

        {showMoveSubmenu && <MoveToSeatSubmenu seats={emptySeats} onClaim={onClaimSeat} />}

        {showKickBan && (
          <>
            {(showSit || showMoveSubmenu) && <div style={SEPARATOR} />}
            <MenuItemBtn label="Kick"   onClick={() => onKick(state.peerId!)} destructive />
            <MenuItemBtn label="Ban"    onClick={() => onBan(state.peerId!)}  destructive />
          </>
        )}
      </div>
    </>
  );
}

function MenuItemBtn({
  label, onClick, destructive = false,
}: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      role="menuitem"
      style={{ ...MENU_ITEM, color: destructive ? '#f47c7c' : '#e8e8e8' }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {label}
    </button>
  );
}

function MoveToSeatSubmenu({
  seats, onClaim,
}: { seats: SeatEntry[]; onClaim: (seatIndex: SeatIndex) => void }) {
  const [open, setOpen] = useState(false);
  const { ref, style } = useFlipPosition(open);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={{ ...MENU_ITEM, display: 'flex', justifyContent: 'space-between', cursor: 'default' }}>
        <span>Move to seat</span><span style={{ color: '#888' }}>▸</span>
      </div>
      {open && (
        <div ref={ref} role="menu" style={{ ...MENU_STYLE, position: 'absolute', ...style, minWidth: 140 }}>
          {seats.map(s => (
            <button
              key={s.index}
              role="menuitem"
              style={{ ...MENU_ITEM, display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => onClaim(s.index)}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span
                style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: s.colour, border: '1px solid rgba(0,0,0,0.4)',
                }}
              />
              Seat {s.index}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
