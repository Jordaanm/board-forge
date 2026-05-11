// Host-only Load scene flow (PRD § Save / Load — issue #3).
//
// Click → hidden <input type="file" accept=".json"> opens picker. Selected
// file is read, parsed, and validated via decodeSaveFile. Validation failures
// surface in an error modal; success shows a preview modal with thumbnail,
// filename, save date, entity count, and a replace-warning. Confirming the
// preview calls onConfirmLoad with the parsed envelope; cancelling discards.

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { decodeSaveFile, SaveFileError, type SaveEnvelope } from '../entity/SaveFile';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  // Number of entities currently in the scene. Used to compose the
  // replace-warning copy in the preview modal.
  currentEntityCount: number;
  onConfirmLoad:     (envelope: SaveEnvelope, filename: string) => void;
  // When provided, the modal populates this ref with an `open()` function
  // that fires the file picker. The host action menu calls it to drive the
  // flow without rendering the built-in trigger button.
  triggerRef?:       React.MutableRefObject<{ open: () => void } | null>;
  hideTrigger?:      boolean;
}

interface PendingPreview {
  envelope: SaveEnvelope;
  filename: string;
}

const BUTTON: React.CSSProperties = {
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
  margin:     '0 0 12px',
};

const ROW: React.CSSProperties = {
  margin:        '4px 0',
  display:       'flex',
  justifyContent: 'space-between',
  gap:           8,
};

const LABEL: React.CSSProperties = {
  color: '#999',
};

const VALUE: React.CSSProperties = {
  color: '#e8e8e8',
};

const THUMB_WRAP: React.CSSProperties = {
  width:        '100%',
  aspectRatio:  '480 / 270',
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.1)',
  borderRadius: 4,
  marginBottom: 12,
  display:      'flex',
  alignItems:   'center',
  justifyContent: 'center',
  color:        '#666',
  overflow:     'hidden',
};

const THUMB_IMG: React.CSSProperties = {
  width:  '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const WARNING: React.CSSProperties = {
  color:    '#ffb74d',
  fontSize: 12,
  margin:   '8px 0',
};

const FOOTER: React.CSSProperties = {
  display:        'flex',
  justifyContent: 'flex-end',
  gap:            8,
  marginTop:      12,
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

const FOOTER_BTN_PRIMARY: React.CSSProperties = {
  ...FOOTER_BTN,
  background: 'rgba(70,130,200,0.7)',
  border:     '1px solid rgba(120,180,240,0.6)',
};

export function LoadSceneModal({ currentEntityCount, onConfirmLoad, triggerRef, hideTrigger }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PendingPreview | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const centerAnchor = useAnchorTarget('center');

  const openPicker = () => {
    inputRef.current?.click();
  };

  useEffect(() => {
    if (!triggerRef) return;
    triggerRef.current = { open: openPicker };
    return () => { triggerRef.current = null; };
  }, [triggerRef]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // allow picking the same file again later
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('Could not read file.');
      return;
    }
    try {
      const envelope = decodeSaveFile(text);
      setPreview({ envelope, filename: file.name });
    } catch (err) {
      setError(err instanceof SaveFileError ? err.message : 'Failed to parse save file.');
    }
  };

  const closeAll = () => {
    setPreview(null);
    setError(null);
  };

  const confirm = () => {
    if (!preview) return;
    onConfirmLoad(preview.envelope, preview.filename);
    closeAll();
  };

  return (
    <>
      {!hideTrigger && (
        <button type="button" style={BUTTON} onClick={openPicker}>Load</button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      <Dialog.Root open={preview !== null} onOpenChange={(o) => { if (!o) closeAll(); }}>
        <Dialog.Portal container={centerAnchor ?? undefined}>
          <Dialog.Overlay style={OVERLAY} />
          <Dialog.Content style={CONTENT} aria-describedby={undefined}>
            <Dialog.Title style={TITLE}>Load Scene</Dialog.Title>
            {preview && (
              <>
                <div style={THUMB_WRAP}>
                  {preview.envelope.thumbnail
                    ? <img src={preview.envelope.thumbnail} alt="" style={THUMB_IMG} />
                    : <span>(no thumbnail)</span>}
                </div>
                <div style={ROW}>
                  <span style={LABEL}>File</span>
                  <span style={VALUE}>{preview.filename}</span>
                </div>
                <div style={ROW}>
                  <span style={LABEL}>Saved</span>
                  <span style={VALUE}>{formatSavedAt(preview.envelope.savedAt)}</span>
                </div>
                <div style={ROW}>
                  <span style={LABEL}>Entities</span>
                  <span style={VALUE}>{preview.envelope.scene.length}</span>
                </div>
                {currentEntityCount > 0 && (
                  <div style={WARNING}>
                    Loading will replace the current scene ({currentEntityCount} {currentEntityCount === 1 ? 'entity' : 'entities'} removed).
                  </div>
                )}
                <div style={FOOTER}>
                  <button type="button" style={FOOTER_BTN} onClick={closeAll}>Cancel</button>
                  <button type="button" style={FOOTER_BTN_PRIMARY} onClick={confirm}>Load</button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={error !== null} onOpenChange={(o) => { if (!o) setError(null); }}>
        <Dialog.Portal container={centerAnchor ?? undefined}>
          <Dialog.Overlay style={OVERLAY} />
          <Dialog.Content style={CONTENT} aria-describedby={undefined}>
            <Dialog.Title style={TITLE}>Could not load scene</Dialog.Title>
            <div style={{ color: '#e57373', fontSize: 12, margin: '4px 0 12px' }}>{error}</div>
            <div style={FOOTER}>
              <button type="button" style={FOOTER_BTN_PRIMARY} onClick={() => setError(null)}>OK</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function formatSavedAt(iso: string): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
