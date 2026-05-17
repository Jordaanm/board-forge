import { useState } from 'react';
import type { RoomStateSnapshot, SeatEntry } from '../seats/RoomState';
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
                displayName={seat.peerId ? displayNameFor(snapshot, seat.peerId) : ''}
                avatarUrl={seat.peerId ? avatarUrlFor(snapshot, seat.peerId) : null}
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
                displayName={displayNameFor(snapshot, peerId)}
                avatarUrl={avatarUrlFor(snapshot, peerId)}
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

function displayNameFor(snapshot: RoomStateSnapshot, peerId: string): string {
  return snapshot.names?.[peerId] ?? peerId.slice(0, 8);
}

function avatarUrlFor(snapshot: RoomStateSnapshot, peerId: string): string | null {
  return snapshot.avatars?.[peerId] ?? null;
}

function Avatar({ avatarUrl, displayName }: { avatarUrl: string | null; displayName: string }) {
  // Drop the image after a broken-image load and fall back to the letter
  // circle, matching the anonymous render path.
  const [broken, setBroken] = useState(false);
  if (avatarUrl !== null && !broken) {
    return (
      <img
        className="players-panel__avatar"
        src={avatarUrl}
        alt=""
        onError={() => setBroken(true)}
      />
    );
  }
  const initial = (Array.from(displayName.trim())[0] ?? '?').toUpperCase();
  return <div className="players-panel__avatar players-panel__avatar--letter">{initial}</div>;
}

function SeatRow({
  seat, displayName, avatarUrl, isSelf, isHostPeer, isActiveTurn, onContextMenu,
}: {
  seat:          SeatEntry;
  displayName:   string;
  avatarUrl:     string | null;
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
      {occupied && <Avatar avatarUrl={avatarUrl} displayName={displayName} />}
      {occupied
        ? <span className="players-panel__name">{displayName}</span>
        : <span className="players-panel__name players-panel__name--placeholder">empty</span>}
      {isHostPeer && <span className="players-panel__badge players-panel__badge--host">host</span>}
      {isSelf && !isHostPeer && <span className="players-panel__badge">you</span>}
    </div>
  );
}

function SpectatorRow({
  peerId, displayName, avatarUrl, isSelf, onContextMenu,
}: {
  peerId:        string;
  displayName:   string;
  avatarUrl:     string | null;
  isSelf:        boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`players-panel__row${isSelf ? ' players-panel__row--self' : ''}`}
      onContextMenu={onContextMenu}
      data-peer-id={peerId}
    >
      <div className="players-panel__swatch players-panel__swatch--empty" />
      <Avatar avatarUrl={avatarUrl} displayName={displayName} />
      <span className="players-panel__name">{displayName}</span>
      {isSelf && <span className="players-panel__badge">you</span>}
    </div>
  );
}

const MENU_STYLE: React.CSSProperties = {
  position: 'fixed', zIndex: 201,
  background: 'var(--surface)', border: '1px solid var(--line)',
  borderRadius: 'var(--panel-radius)', padding: '4px 0', minWidth: 160,
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--ink)',
};

const MENU_HEADER: React.CSSProperties = {
  padding: '8px 16px',
  borderBottom: '1px solid var(--line)',
  background: 'var(--surface-2)',
  userSelect: 'none',
  fontFamily: 'var(--font-sans)',
};

const MENU_ITEM: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 16px',
  background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--ink)',
};

const SEPARATOR: React.CSSProperties = {
  height: 1, margin: '4px 0', background: 'var(--line)',
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
    ? displayNameFor(snapshot, state.peerId)
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
          <div style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
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
      style={{ ...MENU_ITEM, color: destructive ? 'var(--accent-deep)' : 'var(--ink)' }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
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
        <span>Move to seat</span><span style={{ color: 'var(--ink-mute)' }}>▸</span>
      </div>
      {open && (
        <div ref={ref} role="menu" style={{ ...MENU_STYLE, position: 'absolute', ...style, minWidth: 140 }}>
          {seats.map(s => (
            <button
              key={s.index}
              role="menuitem"
              style={{ ...MENU_ITEM, display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => onClaim(s.index)}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
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
