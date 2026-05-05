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

describe('HandPanel — drag-to-canvas (issue #5)', () => {
  function setupPanel() {
    const onPlay = vi.fn();
    const result = render(
      <HandPanel
        cards={SAMPLE}
        selectedId={null}
        onSelectTile={noop}
        onTileContextMenu={noop}
        onPlayCardToTable={onPlay}
      />,
    );
    const tile  = result.getByTestId('hand-panel-tile-c1');
    const panel = result.getByTestId('hand-panel');
    // jsdom returns zeroed rects for layout-less DOM; spoof the panel rect to
    // a known box so the inside/outside check is deterministic.
    panel.getBoundingClientRect = () => ({
      x: 100, y: 500, left: 100, top: 500, right: 300, bottom: 600,
      width: 200, height: 100, toJSON: () => ({}),
    } as DOMRect);
    return { onPlay, tile };
  }

  // jsdom doesn't ship PointerEvent. MouseEvent with the right type matches
  // React's onPointerDown listener and the document-level addEventListener
  // hooks the panel sets up.
  function dispatchPointer(target: EventTarget, type: string, x: number, y: number, button = 0): void {
    const ev = new MouseEvent(type, {
      bubbles: true, cancelable: true, button, clientX: x, clientY: y,
    });
    target.dispatchEvent(ev);
  }
  const pointerDown    = (t: Element, x: number, y: number, button = 0) => dispatchPointer(t, 'pointerdown', x, y, button);
  const docPointerMove = (x: number, y: number) => dispatchPointer(document, 'pointermove', x, y);
  const docPointerUp   = (x: number, y: number) => dispatchPointer(document, 'pointerup',   x, y);

  test('release outside panel after a drag fires onPlayCardToTable with id + coords', () => {
    const { onPlay, tile } = setupPanel();
    pointerDown(tile, 150, 550);     // inside panel
    docPointerMove(800, 200);        // dragged far away (above panel)
    docPointerUp(800, 200);          // released outside panel
    expect(onPlay).toHaveBeenCalledWith('c1', 800, 200);
  });

  test('release inside panel does NOT fire onPlayCardToTable (reorder is issue #6)', () => {
    const { onPlay, tile } = setupPanel();
    pointerDown(tile, 150, 550);
    docPointerMove(220, 540);        // moved within panel beyond drag threshold
    docPointerUp(220, 540);          // still inside panel
    expect(onPlay).not.toHaveBeenCalled();
  });

  test('press-and-release without movement does not fire (treated as click)', () => {
    const { onPlay, tile } = setupPanel();
    pointerDown(tile, 150, 550);
    docPointerUp(151, 551);          // < drag threshold, no pointermove
    expect(onPlay).not.toHaveBeenCalled();
  });

  test('right-click pointerdown is ignored (only left button starts a drag)', () => {
    const { onPlay, tile } = setupPanel();
    pointerDown(tile, 150, 550, 2);  // right button
    docPointerMove(800, 200);
    docPointerUp(800, 200);
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('HandPanel — drag-within-panel reorder (issue #6)', () => {
  // Spoofed tile rects: c1 at [110..160], c2 at [170..220], c3 at [230..280].
  function setupReorderPanel() {
    const onReorder = vi.fn();
    const result = render(
      <HandPanel
        cards={SAMPLE}
        selectedId={null}
        onSelectTile={noop}
        onTileContextMenu={noop}
        onReorderHand={onReorder}
      />,
    );
    const panel = result.getByTestId('hand-panel');
    panel.getBoundingClientRect = () => ({
      x: 100, y: 500, left: 100, top: 500, right: 290, bottom: 600,
      width: 190, height: 100, toJSON: () => ({}),
    } as DOMRect);
    const tiles = SAMPLE.map((card, i) => {
      const t = result.getByTestId(`hand-panel-tile-${card.id}`);
      const left = 110 + i * 60;
      t.getBoundingClientRect = () => ({
        x: left, y: 510, left, top: 510, right: left + 50, bottom: 590,
        width: 50, height: 80, toJSON: () => ({}),
      } as DOMRect);
      return t;
    });
    return { onReorder, panel, tiles };
  }

  function dispatchPointer(target: EventTarget, type: string, x: number, y: number, button = 0): void {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button, clientX: x, clientY: y,
    }));
  }
  const pointerDown    = (t: Element, x: number, y: number) => dispatchPointer(t, 'pointerdown', x, y);
  const docPointerMove = (x: number, y: number) => dispatchPointer(document, 'pointermove', x, y);
  const docPointerUp   = (x: number, y: number) => dispatchPointer(document, 'pointerup',   x, y);

  test('drop on another tile swaps the two', () => {
    const { onReorder, tiles } = setupReorderPanel();
    // Stub elementFromPoint so the drop hits c3's tile.
    document.elementFromPoint = (() => tiles[2]) as Document['elementFromPoint'];

    pointerDown(tiles[0], 135, 550);   // press on c1
    docPointerMove(255, 550);          // drag toward c3
    docPointerUp  (255, 550);          // release on c3

    expect(onReorder).toHaveBeenCalledWith(['c3', 'c2', 'c1']);
  });

  test('drop on a gap inserts at that index', () => {
    const { onReorder, tiles } = setupReorderPanel();
    // No tile under the pointer — drop is in the gap between c2 and c3.
    document.elementFromPoint = (() => null) as Document['elementFromPoint'];

    pointerDown(tiles[0], 135, 550);   // press on c1
    docPointerMove(225, 550);          // drag past c2
    docPointerUp  (225, 550);          // release between c2 and c3 (gap idx = 2)

    // Removing c1 from front and inserting at gap idx 2 - 1 = 1 → [c2, c1, c3]
    expect(onReorder).toHaveBeenCalledWith(['c2', 'c1', 'c3']);
  });

  test('drop on the dragged tile itself is a no-op', () => {
    const { onReorder, tiles } = setupReorderPanel();
    document.elementFromPoint = (() => tiles[0]) as Document['elementFromPoint'];

    pointerDown(tiles[0], 135, 550);
    docPointerMove(140, 552);
    docPointerUp  (140, 552);

    expect(onReorder).not.toHaveBeenCalled();
  });

  test('drop outside panel still routes to onPlayCardToTable, not onReorderHand', () => {
    const onPlay    = vi.fn();
    const onReorder = vi.fn();
    const result = render(
      <HandPanel
        cards={SAMPLE}
        selectedId={null}
        onSelectTile={noop}
        onTileContextMenu={noop}
        onPlayCardToTable={onPlay}
        onReorderHand={onReorder}
      />,
    );
    const panel = result.getByTestId('hand-panel');
    panel.getBoundingClientRect = () => ({
      x: 100, y: 500, left: 100, top: 500, right: 290, bottom: 600,
      width: 190, height: 100, toJSON: () => ({}),
    } as DOMRect);
    const tile = result.getByTestId('hand-panel-tile-c1');

    pointerDown(tile, 130, 550);
    docPointerMove(700, 200);
    docPointerUp  (700, 200);

    expect(onPlay).toHaveBeenCalledWith('c1', 700, 200);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
