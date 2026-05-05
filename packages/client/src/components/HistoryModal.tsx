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
  service: SceneHistoryService | null;
}

const TRIGGER_BTN: React.CSSProperties = {
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 12px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     12,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
  userSelect:   'none',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:        420,
  maxHeight:    '70vh',
  background:   'rgba(20,20,32,0.98)',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:        '#e8e8e8',
  fontFamily:   'sans-serif',
  fontSize:     13,
  zIndex:       201,
  display:      'flex',
  flexDirection: 'column',
  boxShadow:    '0 12px 40px rgba(0,0,0,0.7)',
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
  borderRadius:   4,
  cursor:         'pointer',
  border:         '1px solid transparent',
};

const ROW_CURRENT: React.CSSProperties = {
  ...ROW,
  cursor:     'default',
  background: 'rgba(70,130,200,0.18)',
  border:     '1px solid rgba(120,180,240,0.45)',
};

const THUMB: React.CSSProperties = {
  width:        96,
  height:       54,
  background:   'rgba(0,0,0,0.4)',
  borderRadius: 3,
  border:       '1px solid rgba(255,255,255,0.1)',
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
  color:    '#888',
};

const EMPTY: React.CSSProperties = {
  textAlign: 'center',
  padding:   '24px 16px',
  color:     '#666',
  fontSize:  12,
};

const CURRENT_BADGE: React.CSSProperties = {
  fontSize:  10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:     '#bdbdc0',
};

export function HistoryModal({ service }: Props) {
  const centerAnchor = useAnchorTarget('center');
  const [open, setOpen] = useState(false);

  // On open, push a "Current" anchor so click-to-restore can always return
  // to where the user was when they opened the modal.
  useEffect(() => {
    if (open) service?.push('Current');
  }, [open, service]);

  return (
    <>
      <button type="button" style={TRIGGER_BTN} onClick={() => setOpen(true)}>History</button>
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
