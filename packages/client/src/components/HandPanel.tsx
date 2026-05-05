// Bottom-center anchored panel for the viewer's main hand. Issue #4 of
// planning/issues--hand.md.
//
// Pure presentation: takes a `cards` array (resolved upstream from the main
// hand entity's containedIds + each card's FlatViewComponent.textureRef),
// renders one tile per card. Click selects the corresponding 3D entity;
// right-click invokes the standard entity context menu via the supplied
// callback. No drag interactions in this slice — issues #5 / #6 / #7 add them.

import './HandPanel.css';

export interface CardTile {
  id:         string;
  name:       string;
  textureRef: string;
}

interface Props {
  cards:             CardTile[];
  selectedId:        string | null;
  onSelectTile:      (id: string) => void;
  onTileContextMenu: (id: string, x: number, y: number) => void;
}

export function HandPanel({ cards, selectedId, onSelectTile, onTileContextMenu }: Props) {
  if (cards.length === 0) {
    return (
      <div className="hand-panel" data-testid="hand-panel">
        <div className="hand-panel__placeholder" data-testid="hand-panel-placeholder">
          No cards
        </div>
      </div>
    );
  }
  return (
    <div className="hand-panel" data-testid="hand-panel">
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
        />
      ))}
    </div>
  );
}

function Tile({
  card, selected, onClick, onContextMenu,
}: {
  card:          CardTile;
  selected:      boolean;
  onClick:       () => void;
  onContextMenu: (e: React.MouseEvent) => void;
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
      title={card.name}
    >
      {!card.textureRef && (
        <div className="hand-panel__tile-fallback">{card.name}</div>
      )}
    </div>
  );
}
