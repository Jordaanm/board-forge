// Confirmation modal for the host's Revert action (PRD § Save / Load —
// issue #4). Warns that revert clears the (future) undo history. Cancel
// dismisses; Revert calls the supplied callback.

import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  open:       boolean;
  filename:   string;
  onCancel:   () => void;
  onConfirm:  () => void;
}

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:        420,
  background:   'rgba(20,20,32,0.98)',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:        '#e8e8e8',
  fontFamily:   'sans-serif',
  fontSize:     13,
  zIndex:       201,
  padding:      16,
  boxShadow:    '0 12px 40px rgba(0,0,0,0.7)',
};

const TITLE: React.CSSProperties = {
  fontSize:   14,
  fontWeight: 600,
  margin:     '0 0 8px',
};

const BODY: React.CSSProperties = {
  margin: '8px 0 16px',
  color:  '#cfcfd2',
};

const FOOTER: React.CSSProperties = {
  display:        'flex',
  justifyContent: 'flex-end',
  gap:            8,
};

const FOOTER_BTN: React.CSSProperties = {
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '6px 14px',
  borderRadius: 4,
  cursor:       'pointer',
  fontSize:     12,
};

const FOOTER_BTN_DESTRUCTIVE: React.CSSProperties = {
  ...FOOTER_BTN,
  background: 'rgba(180,70,70,0.7)',
  border:     '1px solid rgba(220,120,120,0.6)',
};

export function RevertConfirmModal({ open, filename, onCancel, onConfirm }: Props) {
  const centerAnchor = useAnchorTarget('center');
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <Dialog.Title style={TITLE}>Revert scene?</Dialog.Title>
          <div style={BODY}>
            Restore <strong>{filename}</strong>. This clears the undo history.
          </div>
          <div style={FOOTER}>
            <button type="button" style={FOOTER_BTN} onClick={onCancel}>Cancel</button>
            <button type="button" style={FOOTER_BTN_DESTRUCTIVE} onClick={onConfirm}>Revert</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
