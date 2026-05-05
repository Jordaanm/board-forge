// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { AnchorLayout } from './AnchorLayout';
import { UIPanel } from './UIPanel';
import { HandPanel, type CardTile } from './HandPanel';

afterEach(cleanup);

const noop = () => {};

const SAMPLE: CardTile[] = [
  { id: 'c1', name: 'Ace',  textureRef: 'ace.png'  },
  { id: 'c2', name: 'King', textureRef: 'king.png' },
  { id: 'c3', name: 'Five', textureRef: ''         },  // missing texture → fallback label
];

describe('HandPanel — rendering', () => {
  test('renders a tile per card in containedIds order', () => {
    const { getAllByTestId } = render(
      <HandPanel cards={SAMPLE} selectedId={null} onSelectTile={noop} onTileContextMenu={noop} />,
    );
    const tiles = getAllByTestId(/^hand-panel-tile-/);
    expect(tiles).toHaveLength(3);
    expect(tiles[0].getAttribute('data-testid')).toBe('hand-panel-tile-c1');
    expect(tiles[1].getAttribute('data-testid')).toBe('hand-panel-tile-c2');
    expect(tiles[2].getAttribute('data-testid')).toBe('hand-panel-tile-c3');
  });

  test('tile applies textureRef as background-image; fallback shows name when missing', () => {
    const { getByTestId } = render(
      <HandPanel cards={SAMPLE} selectedId={null} onSelectTile={noop} onTileContextMenu={noop} />,
    );
    expect(getByTestId('hand-panel-tile-c1').style.backgroundImage).toContain('ace.png');
    expect(getByTestId('hand-panel-tile-c3').textContent).toContain('Five');
  });

  test('selected tile carries the selected attribute and class', () => {
    const { getByTestId } = render(
      <HandPanel cards={SAMPLE} selectedId="c2" onSelectTile={noop} onTileContextMenu={noop} />,
    );
    const tile = getByTestId('hand-panel-tile-c2');
    expect(tile.getAttribute('data-selected')).toBe('true');
    expect(tile.className).toContain('hand-panel__tile--selected');

    const other = getByTestId('hand-panel-tile-c1');
    expect(other.getAttribute('data-selected')).toBeNull();
    expect(other.className).not.toContain('hand-panel__tile--selected');
  });

  test('empty hand renders the placeholder, not tiles', () => {
    const { getByTestId, queryAllByTestId } = render(
      <HandPanel cards={[]} selectedId={null} onSelectTile={noop} onTileContextMenu={noop} />,
    );
    expect(getByTestId('hand-panel-placeholder').textContent).toBe('No cards');
    expect(queryAllByTestId(/^hand-panel-tile-/)).toHaveLength(0);
  });
});

describe('HandPanel — interactions', () => {
  test('left-click on a tile fires onSelectTile with the entity id', () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <HandPanel cards={SAMPLE} selectedId={null} onSelectTile={onSelect} onTileContextMenu={noop} />,
    );
    fireEvent.click(getByTestId('hand-panel-tile-c2'));
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  test('right-click on a tile fires onTileContextMenu with id + cursor coords', () => {
    const onContext = vi.fn();
    const { getByTestId } = render(
      <HandPanel cards={SAMPLE} selectedId={null} onSelectTile={noop} onTileContextMenu={onContext} />,
    );
    fireEvent.contextMenu(getByTestId('hand-panel-tile-c1'), { clientX: 50, clientY: 80 });
    expect(onContext).toHaveBeenCalledWith('c1', 50, 80);
  });

  test('right-click prevents the browser default menu', () => {
    const onContext = vi.fn();
    const { getByTestId } = render(
      <HandPanel cards={SAMPLE} selectedId={null} onSelectTile={noop} onTileContextMenu={onContext} />,
    );
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const tile = getByTestId('hand-panel-tile-c1');
    const dispatched = tile.dispatchEvent(ev);
    expect(dispatched).toBe(false); // preventDefault returns false from dispatchEvent
  });
});

describe('HandPanel — anchor placement', () => {
  test('mounts inside the bottom-center anchor when wrapped in UIPanel', () => {
    const { container } = render(
      <AnchorLayout>
        <UIPanel anchor="bottom-center">
          <HandPanel cards={SAMPLE} selectedId={null} onSelectTile={noop} onTileContextMenu={noop} />
        </UIPanel>
      </AnchorLayout>,
    );
    const anchor = container.querySelector('[data-anchor="bottom-center"]')!;
    expect(anchor.querySelector('[data-testid="hand-panel"]')).not.toBeNull();
  });
});
