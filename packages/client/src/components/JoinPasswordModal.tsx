// Lobby-side password prompt. On submit, opens a probe WebSocket and sends
// a `join` with the supplied password. On `joined`, closes the probe and
// navigates into the room with the password stashed in router state so the
// real ConnectionManager re-sends it. On `joinRejected`, surfaces the error
// inline and keeps the modal open so the user can retry.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';
import { loadDisplayName } from '../identity/displayName';

const SIGNALING_URL = import.meta.env.VITE_API_URL.replace(/^http/, 'ws');

interface Props {
  roomId:       string | null;
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200,
};

const CONTENT: React.CSSProperties = {
  width:         380,
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
  gap:           10,
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

const ERROR_STYLE: React.CSSProperties = {
  color:      'var(--accent-deep)',
  fontSize:   12,
  minHeight:  16,
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
  background:  'var(--accent)',
  color:       'var(--accent-ink)',
  borderColor: 'var(--accent-deep)',
};

type ProbeResult = 'ok' | 'wrongPassword' | 'full' | 'error';

function probeJoin(roomId: string, password: string, displayName: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(SIGNALING_URL);
    const settle = (r: ProbeResult) => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', roomId, role: 'guest', password, displayName }));
    });
    ws.addEventListener('message', (e) => {
      let msg: { type?: string; reason?: string };
      try { msg = JSON.parse(e.data as string); } catch { return; }
      if (msg.type === 'joined')        settle('ok');
      else if (msg.type === 'joinRejected') settle(msg.reason === 'wrongPassword' ? 'wrongPassword' : 'error');
      else if (msg.type === 'room-full')    settle('full');
    });
    ws.addEventListener('error', () => settle('error'));
    ws.addEventListener('close',  () => resolve('error'));  // resolve() no-ops after settle
  });
}

export function JoinPasswordModal({ roomId, open, onOpenChange }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
      setSubmitting(false);
      submittingRef.current = false;
    }
  }, [open]);

  const submit = async () => {
    if (!roomId || submittingRef.current) return;
    const trimmed = password.trim();
    if (trimmed === '') return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const verdict = await probeJoin(roomId, trimmed, loadDisplayName());
    submittingRef.current = false;
    setSubmitting(false);
    if (verdict === 'ok') {
      onOpenChange(false);
      navigate(`/r/${roomId}`, { state: { password: trimmed } });
      return;
    }
    if (verdict === 'wrongPassword') setError('Wrong password.');
    else if (verdict === 'full')     setError('Room is full.');
    else                              setError('Could not connect. Try again.');
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Enter password</Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>
          <div style={BODY}>
            <input
              style={INPUT}
              type="password"
              autoFocus
              autoComplete="off"
              value={password}
              placeholder="Room password"
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void submit(); }
              }}
              aria-label="Room password"
            />
            <div style={ERROR_STYLE} role="alert">{error ?? ''}</div>
          </div>
          <div style={FOOTER}>
            <Dialog.Close asChild>
              <button type="button" style={BTN}>Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              style={BTN_PRIMARY}
              disabled={submitting || password.trim() === ''}
              onClick={() => void submit()}
            >
              {submitting ? 'Joining…' : 'Join'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
