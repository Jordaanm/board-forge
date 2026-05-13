// Tiered host action menu. Replaces the flat row of trigger buttons in the
// host action bar with a single "Tools" button that opens a dropdown of
// grouped submenus. Each leaf invokes an action supplied by HostActionBar
// (typically `setOpen(true)` on a controlled modal, or a direct callback).

import { useEffect, useRef, useState } from 'react';

export interface MenuLeaf {
  label:    string;
  onClick:  () => void;
  disabled?: boolean;
  // Renders a check mark next to the label (used for toggles).
  checked?:  boolean;
}

export interface MenuGroup {
  label: string;
  items: MenuLeaf[];
}

export type MenuEntry = MenuLeaf | MenuGroup;

function isGroup(entry: MenuEntry): entry is MenuGroup {
  return 'items' in entry;
}

interface Props {
  label:   string;
  entries: MenuEntry[];
}

const TRIGGER: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '8px 14px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontFamily:   'var(--font-sans)',
  fontSize:     12,
  fontWeight:   700,
  boxShadow:    'var(--shadow-sm)',
  userSelect:   'none',
};

const PANEL: React.CSSProperties = {
  position:     'absolute',
  top:          'calc(100% + 4px)',
  left:         0,
  background:   'var(--surface)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--panel-radius)',
  padding:      4,
  minWidth:     180,
  boxShadow:    'var(--shadow-lg)',
  zIndex:       200,
  fontFamily:   'var(--font-sans)',
  fontSize:     12,
  color:        'var(--ink)',
};

const SUBPANEL: React.CSSProperties = {
  ...PANEL,
  top:  -4,
  left: 'calc(100% + 4px)',
};

const ITEM: React.CSSProperties = {
  display:      'flex',
  alignItems:   'center',
  justifyContent: 'space-between',
  gap:          12,
  padding:      '6px 10px',
  borderRadius: 4,
  cursor:       'pointer',
  background:   'transparent',
  border:       'none',
  color:        'var(--ink)',
  fontFamily:   'inherit',
  fontSize:     12,
  textAlign:    'left',
  width:        '100%',
  userSelect:   'none',
};

const ITEM_DISABLED: React.CSSProperties = {
  ...ITEM,
  opacity: 0.45,
  cursor:  'not-allowed',
};

const ITEM_ACTIVE: React.CSSProperties = {
  ...ITEM,
  background: 'var(--surface-2)',
};

const GROUP_INDICATOR: React.CSSProperties = {
  color:    'var(--ink-mute)',
  fontSize: 11,
  marginLeft: 8,
};

const CHECK: React.CSSProperties = {
  color:      'var(--moss)',
  fontSize:   11,
  marginLeft: 8,
};

export function HostToolsMenu({ label, entries }: Props) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setActiveGroup(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setActiveGroup(null); }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runLeaf = (leaf: MenuLeaf) => {
    if (leaf.disabled) return;
    setOpen(false);
    setActiveGroup(null);
    leaf.onClick();
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        style={TRIGGER}
        onClick={() => setOpen(o => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div style={PANEL} role="menu">
          {entries.map((entry, i) => {
            if (!isGroup(entry)) {
              return (
                <Leaf key={entry.label} leaf={entry} onSelect={runLeaf} />
              );
            }
            const active = activeGroup === i;
            return (
              <div
                key={entry.label}
                style={{ position: 'relative' }}
                onMouseEnter={() => setActiveGroup(i)}
              >
                <button
                  type="button"
                  style={active ? ITEM_ACTIVE : ITEM}
                  onClick={() => setActiveGroup(active ? null : i)}
                >
                  <span>{entry.label}</span>
                  <span style={GROUP_INDICATOR}>▸</span>
                </button>
                {active && (
                  <div style={SUBPANEL} role="menu">
                    {entry.items.map(item => (
                      <Leaf key={item.label} leaf={item} onSelect={runLeaf} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Leaf({ leaf, onSelect }: { leaf: MenuLeaf; onSelect: (l: MenuLeaf) => void }) {
  return (
    <button
      type="button"
      style={leaf.disabled ? ITEM_DISABLED : ITEM}
      disabled={leaf.disabled}
      onClick={() => onSelect(leaf)}
    >
      <span>{leaf.label}</span>
      {leaf.checked && <span style={CHECK}>✓</span>}
    </button>
  );
}
