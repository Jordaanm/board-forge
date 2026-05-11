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
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 14px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     12,
  fontWeight:   600,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
  userSelect:   'none',
};

const PANEL: React.CSSProperties = {
  position:     'absolute',
  top:          'calc(100% + 4px)',
  left:         0,
  background:   '#1e1e2e',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding:      4,
  minWidth:     180,
  boxShadow:    '0 8px 28px rgba(0,0,0,0.65)',
  zIndex:       200,
  fontFamily:   'sans-serif',
  fontSize:     12,
  color:        '#e8e8e8',
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
  color:        '#e8e8e8',
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
  background: 'rgba(120,180,240,0.18)',
};

const GROUP_INDICATOR: React.CSSProperties = {
  color:    '#888',
  fontSize: 11,
  marginLeft: 8,
};

const CHECK: React.CSSProperties = {
  color:      '#9ee29e',
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
