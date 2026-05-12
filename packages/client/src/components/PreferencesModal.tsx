import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { usePreferences } from '../preferences/usePreferences';
import { ACTION_LABELS, ACTION_NAMES, ROTATE_AMOUNT_VALUES, type ActionName, type DarkMode, type RotateAmount } from '../preferences/types';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:         420,
  background:    'rgba(20,20,32,0.98)',
  border:        '1px solid rgba(255,255,255,0.15)',
  borderRadius:  8,
  color:         '#e8e8e8',
  fontFamily:    'sans-serif',
  fontSize:      13,
  zIndex:        201,
  display:       'flex',
  flexDirection: 'column',
  boxShadow:     '0 12px 40px rgba(0,0,0,0.7)',
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

const BODY: React.CSSProperties = {
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:         '#888',
  marginBottom:  6,
};

const SEG_GROUP: React.CSSProperties = {
  display:      'flex',
  border:       '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
  overflow:     'hidden',
};

function segButton(active: boolean): React.CSSProperties {
  return {
    flex:       1,
    background: active ? 'rgba(80,140,220,0.35)' : 'rgba(0,0,0,0.3)',
    color:      active ? '#fff' : '#cfcfcf',
    border:     'none',
    padding:    '8px 10px',
    cursor:     'pointer',
    fontSize:   13,
    fontFamily: 'sans-serif',
    fontWeight: active ? 600 : 400,
  };
}

const FOOTER: React.CSSProperties = {
  display:        'flex',
  justifyContent: 'flex-end',
  padding:        '10px 16px',
  borderTop:      '1px solid rgba(255,255,255,0.08)',
};

const RESET_BTN: React.CSSProperties = {
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '6px 14px',
  borderRadius: 4,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     13,
};

const DARK_MODE_OPTIONS: { value: DarkMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
];

const CHIP_ROW: React.CSSProperties = {
  display: 'flex',
  gap:     6,
  flexWrap: 'wrap',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    background:   active ? 'rgba(80,140,220,0.35)' : 'rgba(0,0,0,0.3)',
    color:        active ? '#fff' : '#cfcfcf',
    border:       active ? '1px solid rgba(120,170,240,0.6)' : '1px solid rgba(255,255,255,0.2)',
    padding:      '6px 12px',
    borderRadius: 16,
    cursor:       'pointer',
    fontSize:     13,
    fontFamily:   'sans-serif',
    fontWeight:   active ? 600 : 400,
    minWidth:     52,
  };
}

const SECTION_TOGGLE: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  width:          '100%',
  background:     'rgba(0,0,0,0.25)',
  border:         '1px solid rgba(255,255,255,0.12)',
  borderRadius:   6,
  color:          '#cfcfcf',
  padding:        '8px 10px',
  cursor:         'pointer',
  fontFamily:     'sans-serif',
  fontSize:       11,
  textTransform:  'uppercase',
  letterSpacing:  1,
};

const HOTKEY_LIST: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  gap:           6,
  marginTop:     8,
};

const HOTKEY_ROW: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '6px 4px',
  gap:            8,
};

const HOTKEY_LABEL: React.CSSProperties = {
  color:    '#e8e8e8',
  fontSize: 13,
};

function bindingButton(active: boolean): React.CSSProperties {
  return {
    minWidth:     90,
    background:   active ? 'rgba(220,140,80,0.35)' : 'rgba(0,0,0,0.35)',
    color:        active ? '#fff' : '#e8e8e8',
    border:       active ? '1px solid rgba(240,170,120,0.7)' : '1px solid rgba(255,255,255,0.2)',
    borderRadius: 4,
    padding:      '6px 12px',
    cursor:       'pointer',
    fontFamily:   'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize:     13,
    fontWeight:   600,
    textAlign:    'center',
  };
}

function formatKey(key: string): string {
  if (key === '') return 'Unbound';
  if (key === ' ') return 'Space';
  return key.toUpperCase();
}

export function PreferencesModal({ open, onOpenChange }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const { darkMode, setDarkMode, rotateAmount, setRotateAmount, hotkeys, setHotkey, reset } = usePreferences();
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [capturing, setCapturing] = useState<ActionName | null>(null);

  useEffect(() => {
    if (!open) setCapturing(null);
  }, [open]);

  useEffect(() => {
    if (capturing === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setHotkey(capturing, '');
        setCapturing(null);
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length !== 1) return;
      setHotkey(capturing, e.key.toLowerCase());
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, setHotkey]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Preferences</Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>

          <div style={BODY}>
            <div>
              <div style={FIELD_LABEL}>Theme</div>
              <div style={SEG_GROUP} role="radiogroup" aria-label="Theme">
                {DARK_MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={darkMode === opt.value}
                    style={segButton(darkMode === opt.value)}
                    onClick={() => setDarkMode(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={FIELD_LABEL}>Rotate Amount</div>
              <div style={CHIP_ROW} role="radiogroup" aria-label="Rotate Amount">
                {ROTATE_AMOUNT_VALUES.map((value: RotateAmount) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={rotateAmount === value}
                    style={chipStyle(rotateAmount === value)}
                    onClick={() => setRotateAmount(value)}
                  >
                    {value}°
                  </button>
                ))}
              </div>
            </div>

            <div>
              <button
                type="button"
                style={SECTION_TOGGLE}
                aria-expanded={hotkeysOpen}
                onClick={() => setHotkeysOpen(o => !o)}
              >
                <span>Hotkeys</span>
                <span aria-hidden="true">{hotkeysOpen ? '▾' : '▸'}</span>
              </button>
              {hotkeysOpen && (
                <div style={HOTKEY_LIST}>
                  {ACTION_NAMES.map(action => {
                    const active = capturing === action;
                    return (
                      <div key={action} style={HOTKEY_ROW}>
                        <span style={HOTKEY_LABEL}>{ACTION_LABELS[action]}</span>
                        <button
                          type="button"
                          style={bindingButton(active)}
                          onClick={() => setCapturing(active ? null : action)}
                          title="Click, then press a key. Esc cancels, Backspace unbinds."
                        >
                          {active ? 'Press a key…' : formatKey(hotkeys[action])}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={FOOTER}>
            <button style={RESET_BTN} type="button" onClick={reset}>Reset</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
