// Host-only Room Settings modal. Issue #2 lands the Name section; later
// slices add Password and Bans sections in the same shell.

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';

const ROOM_NAME_MAX_LENGTH = 40;

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  roomName:     string;
  onRenameRoom: (name: string) => void;
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

const CLOSE_BTN: React.CSSProperties = {
  background: 'none',
  border:     'none',
  color:      'var(--ink-mute)',
  cursor:     'pointer',
  fontSize:   20,
  lineHeight: 1,
  padding:    '0 4px',
};

const BODY: React.CSSProperties = {
  padding:       '16px',
  display:       'flex',
  flexDirection: 'column',
  gap:           16,
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize:      11,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color:         'var(--ink-mute)',
  fontWeight:    700,
  marginBottom:  6,
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

export function RoomSettingsModal({ open, onOpenChange, roomName, onRenameRoom }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const [draft, setDraft] = useState(roomName);

  // Resync the field whenever the modal reopens or the server-confirmed name
  // changes underneath us (rename echoes back through roomSettingsUpdated).
  useEffect(() => {
    setDraft(roomName);
  }, [roomName, open]);

  const commit = () => {
    const next = draft.trim();
    if (next === roomName.trim()) return;
    onRenameRoom(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Room Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>
          <div style={BODY}>
            <div>
              <div style={FIELD_LABEL}>Name</div>
              <input
                style={INPUT}
                type="text"
                value={draft}
                maxLength={ROOM_NAME_MAX_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
                  if (e.key === 'Escape') { setDraft(roomName); (e.target as HTMLInputElement).blur(); }
                }}
                aria-label="Room name"
              />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
