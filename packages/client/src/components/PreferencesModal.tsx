import * as Dialog from '@radix-ui/react-dialog';
import { usePreferences } from '../preferences/usePreferences';
import { ROTATE_AMOUNT_VALUES, type DarkMode, type RotateAmount } from '../preferences/types';
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

export function PreferencesModal({ open, onOpenChange }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const { darkMode, setDarkMode, rotateAmount, setRotateAmount, reset } = usePreferences();

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
          </div>

          <div style={FOOTER}>
            <button style={RESET_BTN} type="button" onClick={reset}>Reset</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
