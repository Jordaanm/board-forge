// Host-only History modal (PRD § Save / Load — issue #6).
//
// Renders the SceneHistoryService stack newest-at-top. Each row shows the
// thumbnail, label, and relative timestamp. The top row is the current state
// ("you are here") and is non-clickable; clicking any other row instantly
// restores that snapshot via service.restore. Modal-open pushes a "Current"
// snapshot (deduped) so the live state is always retrievable. Modal stays
// open across restores; closes on Esc, X, or outside-click. The list
// subscribes to the service so a snapshot pushed while open appears live.

import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type SceneHistoryService, type UndoEntry } from '../entity/SceneHistoryService';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  service:       SceneHistoryService | null;
  open?:         boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?:  boolean;
}

const TRIGGER_BTN: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '8px 12px',
  borderRadius: 'var(--panel-radius)',
  cursor:       'pointer',
  fontFamily:   'var(--font-sans)',
  fontSize:     12,
  boxShadow:    'var(--shadow-lg)',
  userSelect:   'none',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.45)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:        420,
  maxHeight:    '70vh',
  background:   'var(--surface)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--panel-radius)',
  color:        'var(--ink)',
  fontFamily:   'var(--font-sans)',
  fontSize:     13,
  zIndex:       201,
  display:      'flex',
  flexDirection: 'column',
  boxShadow:    'var(--shadow-lg)',
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

const LIST: React.CSSProperties = {
  flex:      1,
  overflowY: 'auto',
  padding:   8,
  margin:    0,
  listStyle: 'none',
};

const ROW: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:            10,
  padding:        '6px 8px',
  borderRadius:   'var(--card-radius)',
  cursor:         'pointer',
  border:         '1px solid transparent',
};

const ROW_CURRENT: React.CSSProperties = {
  ...ROW,
  cursor:     'default',
  background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
  border:     '1px solid var(--accent)',
};

const THUMB: React.CSSProperties = {
  width:        96,
  height:       54,
  background:   'var(--bg)',
  borderRadius: 3,
  border:       '1px solid var(--line)',
  flexShrink:   0,
  objectFit:    'cover',
  display:      'block',
};

const META: React.CSSProperties = {
  flex:        1,
  minWidth:    0,
  display:     'flex',
  flexDirection: 'column',
  gap:         2,
};

const META_LABEL: React.CSSProperties = {
  whiteSpace:  'nowrap',
  textOverflow: 'ellipsis',
  overflow:    'hidden',
  fontWeight:  500,
};

const META_TIME: React.CSSProperties = {
  fontSize: 11,
  color:    'var(--ink-mute)',
};

const EMPTY: React.CSSProperties = {
  textAlign: 'center',
  padding:   '24px 16px',
  color:     'var(--ink-mute)',
  fontSize:  12,
};

const CURRENT_BADGE: React.CSSProperties = {
  fontSize:  10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:     'var(--ink-2)',
};

export function HistoryModal({ service, open: controlledOpen, onOpenChange, hideTrigger }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // On open, push a "Current" anchor so click-to-restore can always return
  // to where the user was when they opened the modal.
  useEffect(() => {
    if (open) service?.push('Current');
  }, [open, service]);

  return (
    <>
      {!hideTrigger && (
        <button type="button" style={TRIGGER_BTN} onClick={() => setOpen(true)}>History</button>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal container={centerAnchor ?? undefined}>
          <Dialog.Overlay style={OVERLAY} />
          <Dialog.Content style={CONTENT} aria-describedby={undefined}>
            <div style={HEADER}>
              <Dialog.Title style={TITLE}>History</Dialog.Title>
              <Dialog.Close asChild>
                <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
              </Dialog.Close>
            </div>
            {service
              ? <HistoryList service={service} />
              : <div style={EMPTY}>History is host-only.</div>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function HistoryList({ service }: { service: SceneHistoryService }) {
  const entries = useSyncExternalStore(
    (cb) => service.subscribe(cb),
    () => service.entries(),
  );

  if (entries.length === 0) {
    return <div style={EMPTY}>No history yet.</div>;
  }

  // Newest at top; the last pushed entry is the "Current" anchor.
  const reversed = [...entries].reverse();
  const currentIdx = 0;

  return (
    <ul style={LIST}>
      {reversed.map((entry, idx) => {
        const isCurrent = idx === currentIdx;
        return (
          <li
            key={`${entry.timestamp}-${idx}`}
            style={isCurrent ? ROW_CURRENT : ROW}
            onClick={() => { if (!isCurrent) service.restore(entry); }}
            data-testid={`history-row-${idx}`}
          >
            {entry.thumbnail
              ? <img src={entry.thumbnail} alt="" style={THUMB} />
              : <div style={THUMB} />}
            <div style={META}>
              <div style={META_LABEL}>{entry.label}</div>
              <div style={META_TIME}>{formatRelativeTime(entry.timestamp)}</div>
            </div>
            {isCurrent && <span style={CURRENT_BADGE}>You are here</span>}
          </li>
        );
      })}
    </ul>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 5000)        return 'just now';
  if (diffMs < 60_000)      return `${Math.round(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000)   return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000)  return `${Math.round(diffMs / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleString();
}
