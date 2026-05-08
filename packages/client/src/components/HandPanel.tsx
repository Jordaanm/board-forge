// Bottom-center anchored panel for the viewer's main hand. Issue #4 of
// planning/issues--hand.md.
//
// Pure presentation: takes a `cards` array (resolved upstream from the main
// hand entity's containedIds + each card's FlatViewComponent.textureRef),
// renders one tile per card. Click selects the corresponding 3D entity;
// right-click invokes the standard entity context menu. Pointerdown + drag
// out of the panel triggers `onPlayCardToTable` (issue #5).
//
// Issue #5 of issues--interaction.md adds parallel input lifecycle dispatch
// (`pressed` / `released` / `click`) on the per-entity bus, so scripts and
// components react to FlatView clicks the same way they react to 3D clicks.
// Issue #6 layers `hover-start` / `hover-end` on the same callback. `worldHit`
// is intentionally absent from the payload — scripts use `if (e.worldHit)`
// as a 3D / 2D discriminant.

import { useEffect, useRef } from 'react';
import { registerDropTarget } from '../input/dropTargetRegistry';
import { type InputEventName, type InputEventPayload } from '../input/inputEvents';
import { type SeatIndex } from '../seats/SeatLayout';
import './HandPanel.css';

export interface CardTile {
  id:         string;
  name:       string;
  textureRef: string;
}

interface Props {
  cards:              CardTile[];
  selectedId:         string | null;
  onSelectTile:       (id: string) => void;
  onTileContextMenu:  (id: string, x: number, y: number) => void;
  onPlayCardToTable?: (id: string, x: number, y: number) => void;
  onReorderHand?:     (newOrder: string[]) => void;
  // When set, registers the panel root with `dropTargetRegistry` so GrabTool
  // can route 3D releases over the panel into this hand. Issue #7.
  handEntityId?:      string;
  // Issue #5 of issues--interaction.md. When set, HandPanel dispatches
  // `pressed` / `released` / `click` on the per-entity bus through this
  // callback. Parent (ThreeCanvas via Room) wires it to `World.fireInputEvent`
  // so dual-fire RPC works identically to 3D. Issue #6 will layer the hover
  // events on the same callback.
  onTileInputEvent?:  (tileId: string, eventName: InputEventName, payload: InputEventPayload) => void;
  // Populates `payload.seat` for FlatView events. `null` is the unseated case
  // (spectator). Defaults to null when omitted.
  selfSeat?:          SeatIndex | null;
}

// Pixels of pointer travel before we treat a press-drag-release as a drag
// rather than a click. Below the threshold the press is treated as a click
// regardless of where the pointer is at release.
const DRAG_THRESHOLD_PX = 5;
// Click thresholds for the input lifecycle dispatch (issue #5). Match
// `GrabTool.MOVE_PX` / `HOLD_MS` so FlatView semantics align with 3D.
const CLICK_MOVE_PX = 5;
const CLICK_HOLD_MS = 150;

export function HandPanel({
  cards, selectedId, onSelectTile, onTileContextMenu, onPlayCardToTable, onReorderHand,
  handEntityId, onTileInputEvent, selfSeat,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelRef.current || !handEntityId) return;
    return registerDropTarget(panelRef.current, { kind: 'hand-panel', handEntityId });
  }, [handEntityId]);

  const buildPayload = (e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): InputEventPayload => ({
    seat:     selfSeat ?? null,
    shiftKey: e.shiftKey,
    ctrlKey:  e.ctrlKey,
    altKey:   e.altKey,
    // worldHit intentionally absent — FlatView events have no 3D coords.
  });

  const handleTilePointerDown = (cardId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;          // left button only

    onTileInputEvent?.(cardId, 'pressed', buildPayload(e));

    const startX = e.clientX;
    const startY = e.clientY;
    const startT = performance.now();
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= DRAG_THRESHOLD_PX) {
        dragged = true;
      }
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);

      // Released always pairs with the captured tile — same 3D semantics.
      onTileInputEvent?.(cardId, 'released', buildPayload(ev));

      // Click fires only when within thresholds AND cursor is still over the
      // captured tile. elementFromPoint walks the actual DOM at release time
      // so a release dragged off the tile (e.g. onto another tile) is
      // correctly excluded.
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy <= CLICK_MOVE_PX * CLICK_MOVE_PX
          && performance.now() - startT < CLICK_HOLD_MS
          && isPointOverTile(ev.clientX, ev.clientY, cardId)) {
        onTileInputEvent?.(cardId, 'click', buildPayload(ev));
      }

      // ── Existing drag flow — unchanged. ────────────────────────────────
      if (!dragged) return;
      if (!onPlayCardToTable && !onReorderHand) return;
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const insidePanel =
           ev.clientX >= rect.left && ev.clientX <= rect.right
        && ev.clientY >= rect.top  && ev.clientY <= rect.bottom;
      if (!insidePanel) {
        onPlayCardToTable?.(cardId, ev.clientX, ev.clientY);
        return;
      }
      if (onReorderHand) {
        const next = computeReorder(cards, cardId, ev.clientX, panel);
        if (next) onReorderHand(next);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  };

  return (
    <div className="hand-panel" data-testid="hand-panel" ref={panelRef}>
      {cards.length === 0 && (
        <div className="hand-panel__placeholder" data-testid="hand-panel-placeholder">
          No cards
        </div>
      )}
      {cards.map(card => (
        <Tile
          key={card.id}
          card={card}
          selected={card.id === selectedId}
          onClick={() => onSelectTile(card.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            onTileContextMenu(card.id, e.clientX, e.clientY);
          }}
          onPointerDown={handleTilePointerDown(card.id)}
        />
      ))}
    </div>
  );
}

// Resolves the dropped card's new position in the hand. If the pointer hits
// another tile, swap with that tile. Otherwise insert at the gap index closest
// to the pointer's X. Returns null when the result would be an unchanged order.
function computeReorder(
  cards:     readonly CardTile[],
  draggedId: string,
  clientX:   number,
  panel:     HTMLElement,
): string[] | null {
  const ids = cards.map(c => c.id);
  const fromIdx = ids.indexOf(draggedId);
  if (fromIdx < 0) return null;

  const tileEls = Array.from(panel.querySelectorAll<HTMLElement>('[data-tile-id]'));
  let hitTileId: string | null = null;
  let hitIdx    = -1;
  let gapInsertIdx = tileEls.length;

  for (let i = 0; i < tileEls.length; i++) {
    const r = tileEls[i].getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) {
      hitTileId = tileEls[i].getAttribute('data-tile-id');
      hitIdx    = i;
      break;
    }
    if (clientX < r.left + r.width / 2) { gapInsertIdx = i; break; }
  }

  // Drop on a tile → swap (no-op if same as dragged tile).
  if (hitTileId !== null) {
    if (hitTileId === draggedId) return null;
    const next = [...ids];
    [next[fromIdx], next[hitIdx]] = [next[hitIdx], next[fromIdx]];
    return next;
  }

  // Drop on a gap → remove dragged then re-insert at the gap index.
  const without = ids.filter((_, i) => i !== fromIdx);
  const insertAt = gapInsertIdx > fromIdx ? gapInsertIdx - 1 : gapInsertIdx;
  const next = [...without.slice(0, insertAt), draggedId, ...without.slice(insertAt)];
  if (sameOrder(next, ids)) return null;
  return next;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Walks the parent chain of whatever's under the cursor looking for a tile
// element with the matching data-tile-id. Used to gate `click` dispatch on
// "cursor still over the captured tile" — same intent as the 3D-side check
// in InputDispatcher.
function isPointOverTile(clientX: number, clientY: number, tileId: string): boolean {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return false;
  const el = document.elementFromPoint(clientX, clientY);
  let cur: Element | null = el;
  while (cur) {
    if (cur.getAttribute && cur.getAttribute('data-tile-id') === tileId) return true;
    cur = cur.parentElement;
  }
  return false;
}

function Tile({
  card, selected, onClick, onContextMenu, onPointerDown,
}: {
  card:          CardTile;
  selected:      boolean;
  onClick:       () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const cls = `hand-panel__tile${selected ? ' hand-panel__tile--selected' : ''}`;
  return (
    <div
      className={cls}
      data-testid={`hand-panel-tile-${card.id}`}
      data-tile-id={card.id}
      data-selected={selected || undefined}
      style={card.textureRef ? { backgroundImage: `url(${card.textureRef})` } : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      title={card.name}
    >
      {!card.textureRef && (
        <div className="hand-panel__tile-fallback">{card.name}</div>
      )}
    </div>
  );
}
