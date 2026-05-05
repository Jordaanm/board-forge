// Bottom-center anchored panel for the viewer's main hand. Issue #4 of
// planning/issues--hand.md.
//
// Pure presentation: takes a `cards` array (resolved upstream from the main
// hand entity's containedIds + each card's FlatViewComponent.textureRef),
// renders one tile per card. Click selects the corresponding 3D entity;
// right-click invokes the standard entity context menu. Pointerdown + drag
// out of the panel triggers `onPlayCardToTable` (issue #5).

import { useEffect, useRef } from 'react';
import { registerDropTarget } from '../input/dropTargetRegistry';
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
}

// Pixels of pointer travel before we treat a press-drag-release as a drag
// rather than a click. Below the threshold the press is treated as a click
// regardless of where the pointer is at release.
const DRAG_THRESHOLD_PX = 5;

export function HandPanel({
  cards, selectedId, onSelectTile, onTileContextMenu, onPlayCardToTable, onReorderHand,
  handEntityId,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelRef.current || !handEntityId) return;
    return registerDropTarget(panelRef.current, { kind: 'hand-panel', handEntityId });
  }, [handEntityId]);

  const handleTilePointerDown = (cardId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;          // left button only
    if (!onPlayCardToTable && !onReorderHand) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= DRAG_THRESHOLD_PX) {
        dragged = true;
      }
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
      if (!dragged) return;              // pure click — onClick handles select
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
