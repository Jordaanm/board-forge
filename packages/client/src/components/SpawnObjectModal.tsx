// Host-only modal listing every registered spawnable. Search by label /
// category / type / tag with ranked results; arrow keys + Enter for keyboard
// nav; spawned rows flash briefly. Modal stays open for batch spawning.

import { forwardRef, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { listSpawnables, type SpawnableDef } from '../entity/SpawnableRegistry';
import { groupByCategory, searchSpawnables } from '../entity/spawnableSearch';
import { useAnchorTarget } from './AnchorLayout';
import './SpawnObjectModal.css';

interface Props {
  onSpawn: (type: string) => void;
}

const TRIGGER_BTN: React.CSSProperties = {
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 16px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     13,
  fontWeight:   600,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:       520,
  height:      600,
  background:  'rgba(20,20,32,0.98)',
  border:      '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:       '#e8e8e8',
  fontFamily:  'sans-serif',
  fontSize:    13,
  zIndex:      201,
  display:     'flex',
  flexDirection: 'column',
  boxShadow:   '0 12px 40px rgba(0,0,0,0.7)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid rgba(255,255,255,0.1)',
};

const TITLE: React.CSSProperties = {
  fontSize:   14,
  fontWeight: 600,
  margin:     0,
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none',
  border:     'none',
  color:      '#aaa',
  cursor:     'pointer',
  fontSize:   18,
  lineHeight: 1,
  padding:    '0 4px',
};

const SEARCH_WRAP: React.CSSProperties = {
  padding:     '10px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const SEARCH_INPUT: React.CSSProperties = {
  width:        '100%',
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '6px 10px',
  borderRadius: 4,
  fontSize:     13,
  fontFamily:   'sans-serif',
  boxSizing:    'border-box',
  outline:      'none',
};

const SCROLL: React.CSSProperties = {
  flex:      1,
  overflowY: 'auto',
  padding:   '6px 0',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:         '#888',
  margin:        '8px 16px 4px',
};

const ROW_CATEGORY: React.CSSProperties = {
  color:    '#777',
  fontSize: 11,
};

const EMPTY: React.CSSProperties = {
  color:      '#666',
  fontSize:   12,
  textAlign:  'center',
  padding:    '24px 16px',
};

export function SpawnObjectModal({ onSpawn }: Props) {
  const centerAnchor = useAnchorTarget('center');
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button style={TRIGGER_BTN} type="button">+ Spawn Object</button>
      </Dialog.Trigger>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Spawn Object</Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>
          <ModalBody onSpawn={onSpawn} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Reads the registry on mount. The Radix Portal/Content only mounts children
// when the dialog opens, so by the time this renders, the World constructor
// in ThreeCanvas has already run registerCorePrimitives().
function ModalBody({ onSpawn }: { onSpawn: (type: string) => void }) {
  const allDefs = listSpawnables();
  const [query, setQuery]     = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const [flashType, setFlashType] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const focusedRowRef = useRef<HTMLLIElement | null>(null);

  const isSearching = query.trim() !== '';
  const groups      = isSearching ? null : groupByCategory(allDefs);
  const flatItems: SpawnableDef[] = isSearching
    ? searchSpawnables(allDefs, query)
    : (groups ?? []).flatMap(g => g.items);

  // Reset focus when query changes; clamp when list shrinks below current idx.
  useEffect(() => { setFocusIdx(0); }, [query]);
  useEffect(() => {
    if (flatItems.length > 0 && focusIdx >= flatItems.length) setFocusIdx(0);
  }, [flatItems.length, focusIdx]);

  // Scroll the focused row into view as it changes.
  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx]);

  // Cleanup the flash timer on unmount.
  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  const triggerSpawn = (def: SpawnableDef) => {
    onSpawn(def.type);
    setFlashType(def.type);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashType(null), 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatItems.length === 0) return;
      setFocusIdx(i => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length === 0) return;
      setFocusIdx(i => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const def = flatItems[focusIdx];
      if (def) triggerSpawn(def);
    }
  };

  return (
    <>
      <div style={SEARCH_WRAP}>
        <input
          style={SEARCH_INPUT}
          type="text"
          autoFocus
          placeholder="Search spawnables…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div style={SCROLL}>
        {flatItems.length === 0 && (
          <div style={EMPTY}>No spawnables match “{query}”.</div>
        )}

        {isSearching && flatItems.map((def, i) => (
          <Row
            key={def.type}
            def={def}
            focused={i === focusIdx}
            flashing={flashType === def.type}
            showCategory
            ref={i === focusIdx ? focusedRowRef : null}
            onClick={() => triggerSpawn(def)}
          />
        ))}

        {!isSearching && groups?.map((group) => (
          <section key={group.category}>
            <div style={SECTION_LABEL}>{group.category}</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {group.items.map((def) => {
                const idx = flatItems.indexOf(def);
                return (
                  <Row
                    key={def.type}
                    def={def}
                    focused={idx === focusIdx}
                    flashing={flashType === def.type}
                    showCategory={false}
                    ref={idx === focusIdx ? focusedRowRef : null}
                    onClick={() => triggerSpawn(def)}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

interface RowProps {
  def:          SpawnableDef;
  focused:      boolean;
  flashing:     boolean;
  showCategory: boolean;
  onClick:      () => void;
}

const ROW_BASE: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '10px 20px',
  cursor:         'pointer',
  userSelect:     'none',
  transition:     'background 0.15s ease',
};

const Row = forwardRef<HTMLLIElement, RowProps>(function Row(
  { def, focused, flashing, showCategory, onClick },
  ref,
) {
  const classes = ['spawn-modal__row'];
  if (focused)  classes.push('spawn-modal__row--focused');
  if (flashing) classes.push('spawn-modal__row--flash');
  return (
    <li
      ref={ref}
      className={classes.join(' ')}
      style={ROW_BASE}
      onClick={onClick}
    >
      <span>{def.label}</span>
      {showCategory && <span style={ROW_CATEGORY}>{def.category}</span>}
    </li>
  );
});
