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
  background: 'rgba(0,0,0,0.45)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:        420,
  background:   'var(--surface)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--panel-radius)',
  color:        'var(--ink)',
  fontFamily:   'var(--font-sans)',
  fontSize:     13,
  zIndex:       201,
  padding:      16,
  boxShadow:    'var(--shadow-lg)',
};

const TITLE: React.CSSProperties = {
  fontSize:      14,
  fontWeight:    600,
  margin:        '0 0 8px',
  fontFamily:    'var(--font-serif)',
  letterSpacing: '-0.01em',
};

const BODY: React.CSSProperties = {
  margin: '8px 0 16px',
  color:  'var(--ink-2)',
};

const FOOTER: React.CSSProperties = {
  display:        'flex',
  justifyContent: 'flex-end',
  gap:            8,
};

const FOOTER_BTN: React.CSSProperties = {
  background:   'var(--bg)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '6px 14px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontSize:     12,
};

const FOOTER_BTN_DESTRUCTIVE: React.CSSProperties = {
  ...FOOTER_BTN,
  background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
  border:     '1px solid var(--accent-deep)',
  color:      'var(--accent-deep)',
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
