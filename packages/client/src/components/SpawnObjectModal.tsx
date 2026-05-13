// Host-only modal listing every registered spawnable. Search by label /
// category / type / tag with ranked results; arrow keys + Enter for keyboard
// nav; spawned rows flash briefly. Modal stays open for batch spawning.

import { forwardRef, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { listPublicSpawnables, type SpawnableDef } from '../entity/SpawnableRegistry';
import { groupByCategory, searchSpawnables } from '../entity/spawnableSearch';
import { useAnchorTarget } from './AnchorLayout';
import './SpawnObjectModal.css';

interface Props {
  onSpawn:       (type: string) => void;
  open?:         boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?:  boolean;
}

const TRIGGER_BTN: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '8px 16px',
  borderRadius: 'var(--panel-radius)',
  cursor:       'pointer',
  fontFamily:   'var(--font-sans)',
  fontSize:     13,
  fontWeight:   600,
  boxShadow:    'var(--shadow-lg)',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.45)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:       520,
  height:      600,
  background:  'var(--surface)',
  border:      '1px solid var(--line)',
  borderRadius: 'var(--panel-radius)',
  color:       'var(--ink)',
  fontFamily:  'var(--font-sans)',
  fontSize:    13,
  zIndex:      201,
  display:     'flex',
  flexDirection: 'column',
  boxShadow:   'var(--shadow-lg)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid var(--line)',
};

const TITLE: React.CSSProperties = {
  fontSize:      14,
  fontWeight:    600,
  margin:        0,
  fontFamily:    'var(--font-serif)',
  letterSpacing: '-0.01em',
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none',
  border:     'none',
  color:      'var(--ink-mute)',
  cursor:     'pointer',
  fontSize:   18,
  lineHeight: 1,
  padding:    '0 4px',
};

const SEARCH_WRAP: React.CSSProperties = {
  padding:     '10px 16px',
  borderBottom: '1px solid var(--line)',
};

const SEARCH_INPUT: React.CSSProperties = {
  width:        '100%',
  background:   'var(--bg)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '6px 10px',
  borderRadius: 'var(--card-radius)',
  fontSize:     13,
  fontFamily:   'var(--font-sans)',
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
  color:         'var(--ink-mute)',
  margin:        '8px 16px 4px',
};

const ROW_CATEGORY: React.CSSProperties = {
  color:    'var(--ink-mute)',
  fontSize: 11,
};

const EMPTY: React.CSSProperties = {
  color:      'var(--ink-mute)',
  fontSize:   12,
  textAlign:  'center',
  padding:    '24px 16px',
};

export function SpawnObjectModal({ onSpawn, open: controlledOpen, onOpenChange, hideTrigger }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <Dialog.Trigger asChild>
          <button style={TRIGGER_BTN} type="button">+ Spawn Object</button>
        </Dialog.Trigger>
      )}
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
  const allDefs = listPublicSpawnables();
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
