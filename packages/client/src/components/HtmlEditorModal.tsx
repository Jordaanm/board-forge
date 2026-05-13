// Monaco-backed HTML editor in a Radix Dialog modal. Used by the Surface
// Elements editor row to edit a rich element's `html` field in a roomy
// pane (the inline preview in the panel is read-only). Save commits via
// the parent's `onSave(next)`; Cancel discards local edits.
//
// Lazy-loaded so the Monaco worker bundles stay out of the initial
// Room render — same pattern as ScriptEditorModal.

import { lazy, Suspense, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

const HtmlEditor = lazy(() => import('./HtmlEditor'));

interface Props {
  open:    boolean;
  initial: string;
  onClose: () => void;
  onSave:  (next: string) => void;
}

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.45)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  position:      'fixed',
  top:           '50%',
  left:          '50%',
  transform:     'translate(-50%, -50%)',
  width:         '85vw',
  maxWidth:      1100,
  height:        '80vh',
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
  flexShrink:     0,
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

const BODY: React.CSSProperties = {
  flex:          1,
  display:       'flex',
  flexDirection: 'column',
  padding:       '12px 16px',
  gap:           8,
  minHeight:     0,
};

const EDITOR_LOADING: React.CSSProperties = {
  flex:          '1 1 auto',
  minHeight:     220,
  display:       'flex',
  alignItems:    'center',
  justifyContent: 'center',
  background:    'var(--bg)',
  border:        '1px solid var(--line-strong)',
  color:         'var(--ink-mute)',
  borderRadius:  3,
  fontSize:      12,
};

const FOOTER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'flex-end',
  gap:            8,
  paddingTop:     8,
  borderTop:      '1px solid var(--line)',
  flexShrink:     0,
};

const BTN: React.CSSProperties = {
  background:   'var(--surface-2)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '6px 14px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontSize:     12,
};

const PRIMARY: React.CSSProperties = {
  ...BTN,
  background:   'color-mix(in oklab, var(--accent) 22%, transparent)',
  borderColor:  'var(--accent)',
};

export function HtmlEditorModal({ open, initial, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(initial);

  // Reseed when the modal reopens with a fresh `initial` so a previous
  // session's draft doesn't bleed into a new edit on a different element.
  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const handleSave = () => onSave(draft);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content
          style={CONTENT}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault();
              handleSave();
            }
          }}
        >
          <Dialog.Title asChild>
            <div style={HEADER}>
              <h2 style={TITLE}>Edit HTML</h2>
              <button style={CLOSE_BTN} onClick={onClose} title="Close">×</button>
            </div>
          </Dialog.Title>
          <Dialog.Description asChild>
            <div style={BODY}>
              <Suspense fallback={<div style={EDITOR_LOADING}>Loading editor…</div>}>
                <HtmlEditor source={draft} onChange={setDraft} onSave={handleSave} />
              </Suspense>
              <div style={FOOTER}>
                <button style={BTN} onClick={onClose}>Cancel</button>
                <button style={PRIMARY} onClick={handleSave}>Save</button>
              </div>
            </div>
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
