import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';
import {
  MAX_DISPLAY_NAME_LENGTH,
  generateDisplayName,
  loadDisplayName,
  markDisplayNamePrompted,
  saveDisplayName,
} from '../identity/displayName';

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200,
};

const CONTENT: React.CSSProperties = {
  width:         420,
  background:    'var(--surface)',
  border:        '1px solid var(--line)',
  borderRadius:  'var(--panel-radius)',
  color:         'var(--ink)',
  fontFamily:    'var(--font-sans)',
  fontSize:      13,
  zIndex:        201,
  display:       'flex',
  flexDirection: 'column',
  boxShadow:     'var(--shadow-lg)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid var(--line)',
  background:     'var(--surface-2)',
};

const TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize:   17,
  fontWeight: 600,
  margin:     0,
  color:      'var(--ink)',
};

const BODY: React.CSSProperties = {
  padding:       '16px',
  display:       'flex',
  flexDirection: 'column',
  gap:           12,
};

const HINT: React.CSSProperties = {
  color:    'var(--ink-mute)',
  fontSize: 12,
  lineHeight: 1.4,
};

const INPUT: React.CSSProperties = {
  background:   'var(--bg)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--card-radius)',
  color:        'var(--ink)',
  fontFamily:   'inherit',
  fontSize:     14,
  padding:      '8px 10px',
  width:        '100%',
  boxSizing:    'border-box',
};

const FOOTER: React.CSSProperties = {
  display:        'flex',
  justifyContent: 'flex-end',
  gap:            8,
  padding:        '10px 16px',
  borderTop:      '1px solid var(--line)',
  background:     'var(--surface-2)',
};

const BTN: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '6px 14px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontFamily:   'inherit',
  fontSize:     13,
  fontWeight:   700,
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background: 'var(--accent)',
  color:      'var(--accent-ink)',
  borderColor: 'var(--accent-deep)',
};

export function DisplayNamePromptModal({ open, onOpenChange }: Props) {
  const centerAnchor = useAnchorTarget('center');
  // Capture the current name once when the modal opens so the input shows a
  // stable suggested fallback (the auto-generated one already persisted by
  // loadDisplayName) the user can accept, edit, or replace.
  const [value, setValue] = useState(() => loadDisplayName());

  useEffect(() => {
    if (open) setValue(loadDisplayName());
  }, [open]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') saveDisplayName(generateDisplayName());
    else                saveDisplayName(trimmed);
    markDisplayNamePrompted();
    onOpenChange(false);
  };

  const skip = () => {
    // Keep whatever loadDisplayName persisted (auto-generated). Just mark
    // prompted so the lobby doesn't ask again.
    markDisplayNamePrompted();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) markDisplayNamePrompted(); onOpenChange(o); }}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content
          style={CONTENT}
          aria-describedby={undefined}
          onEscapeKeyDown={skip}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Choose a display name</Dialog.Title>
          </div>
          <div style={BODY}>
            <div style={HINT}>
              This is how other players will see you. Stored in this browser only.
            </div>
            <input
              style={INPUT}
              type="text"
              autoFocus
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(value); }
              }}
              aria-label="Display name"
            />
          </div>
          <div style={FOOTER}>
            <button type="button" style={BTN} onClick={skip}>Skip</button>
            <button type="button" style={BTN_PRIMARY} onClick={() => commit(value)}>Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
