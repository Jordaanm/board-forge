// Bottom-center anchored panel for the viewer's main hand. Issue #4 of
// planning/issues--hand.md.
//
// Pure presentation: takes a `cards` array (resolved upstream from the main
// hand entity's containedIds + each card's FlatViewComponent.textureRef),
// renders one tile per card. Click selects the corresponding 3D entity;
// right-click invokes the standard entity context menu. Pointerdown + drag
// out of the panel triggers `onPlayCardToTable` (issue #5).

import { useRef } from 'react';
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
}

// Pixels of pointer travel before we treat a press-drag-release as a drag
// rather than a click. Below the threshold the press is treated as a click
// regardless of where the pointer is at release.
const DRAG_THRESHOLD_PX = 5;

export function HandPanel({
  cards, selectedId, onSelectTile, onTileContextMenu, onPlayCardToTable,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  if (cards.length === 0) {
    return (
      <div className="hand-panel" data-testid="hand-panel" ref={panelRef}>
        <div className="hand-panel__placeholder" data-testid="hand-panel-placeholder">
          No cards
        </div>
      </div>
    );
  }

  const handleTilePointerDown = (cardId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;          // left button only
    if (!onPlayCardToTable) return;
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
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const insidePanel =
           ev.clientX >= rect.left && ev.clientX <= rect.right
        && ev.clientY >= rect.top  && ev.clientY <= rect.bottom;
      if (insidePanel) return;           // within-panel reorder is issue #6
      onPlayCardToTable(cardId, ev.clientX, ev.clientY);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  };

  return (
    <div className="hand-panel" data-testid="hand-panel" ref={panelRef}>
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
