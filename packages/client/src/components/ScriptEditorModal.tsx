import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type RunResult } from '../scripting/ScriptHost';
import { type ScriptErrorLog, type ScriptErrorEntry } from '../scripting/ScriptErrorLog';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  source:         string;
  onChange:       (next: string) => void;
  onSave:         () => void;
  onRun:          (source: string) => Promise<RunResult>;
  // Returns the runtime's currently-persisted source. Called on close-attempt
  // to compute dirty state. Single source of truth — modal does not mirror
  // the baseline in React.
  getSavedSource: () => string;
  errorLog?:      ScriptErrorLog | null;
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
  position:      'relative',
  width:         '90vw',
  maxWidth:      1400,
  height:        '88vh',
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
  flexShrink:     0,
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
  flex:          1,
  display:       'flex',
  flexDirection: 'column',
  padding:       '12px 16px',
  gap:           8,
  minHeight:     0,
};

const TEXTAREA: React.CSSProperties = {
  flex:          '1 1 auto',
  minHeight:     0,
  background:    'rgba(0,0,0,0.4)',
  border:        '1px solid rgba(255,255,255,0.2)',
  color:         '#e8e8e8',
  padding:       '8px 10px',
  borderRadius:  3,
  fontSize:      13,
  fontFamily:    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  boxSizing:     'border-box',
  resize:        'vertical',
};

const BUTTON_ROW: React.CSSProperties = {
  display:    'flex',
  gap:        8,
  flexShrink: 0,
};

const BUTTON: React.CSSProperties = {
  background:   'rgba(255,255,255,0.1)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 14px',
  borderRadius: 4,
  cursor:       'pointer',
  fontSize:     13,
  flex:         1,
};

const LOG_LIST: React.CSSProperties = {
  maxHeight:  '25%',
  overflowY:  'auto',
  borderTop:  '1px solid rgba(255,255,255,0.08)',
  paddingTop: 8,
  flexShrink: 0,
};

const LOG_HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  marginBottom:   6,
};

const LOG_LABEL: React.CSSProperties = {
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:         '#888',
};

const LOG_CLEAR: React.CSSProperties = {
  background:   'none',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#bbb',
  padding:      '2px 8px',
  borderRadius: 3,
  cursor:       'pointer',
  fontSize:     11,
};

const LOG_ENTRY: React.CSSProperties = {
  marginBottom: 4,
  padding:      '4px 6px',
  background:   'rgba(220,80,80,0.10)',
  border:       '1px solid rgba(220,80,80,0.25)',
  borderRadius: 3,
  color:        '#ffb0b0',
  fontFamily:   'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize:     11,
  whiteSpace:   'pre-wrap',
  wordBreak:    'break-word',
};

// Compile failures look distinct from runtime hook/listener throws so the
// host can tell at a glance whether the script never started or failed
// mid-execution.
const LOG_ENTRY_COMPILE: React.CSSProperties = {
  ...LOG_ENTRY,
  background: 'rgba(80,140,220,0.10)',
  border:     '1px solid rgba(80,140,220,0.30)',
  color:      '#bcd0f0',
};

const BADGE_BASE: React.CSSProperties = {
  display:       'inline-block',
  padding:       '1px 6px',
  borderRadius:  3,
  fontSize:      9,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontWeight:    600,
  marginRight:   6,
};

const BADGE_COMPILE: React.CSSProperties = {
  ...BADGE_BASE,
  background: 'rgba(80,140,220,0.25)',
  color:      '#cfdef7',
};

const BADGE_HOOK: React.CSSProperties = {
  ...BADGE_BASE,
  background: 'rgba(220,80,80,0.25)',
  color:      '#ffd0d0',
};

const BADGE_EVENT: React.CSSProperties = {
  ...BADGE_BASE,
  background: 'rgba(220,140,80,0.25)',
  color:      '#ffe0c0',
};

const LOG_META: React.CSSProperties = {
  color:    '#888',
  fontSize: 10,
};

const CONFIRM_BACKDROP: React.CSSProperties = {
  position:       'absolute',
  inset:          0,
  background:     'rgba(0,0,0,0.55)',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  zIndex:         1,
  borderRadius:   8,
};

const CONFIRM_BOX: React.CSSProperties = {
  width:        360,
  background:   'rgba(28,28,40,0.98)',
  border:       '1px solid rgba(255,255,255,0.18)',
  borderRadius: 6,
  padding:      '16px 18px',
  boxShadow:    '0 8px 28px rgba(0,0,0,0.6)',
};

const CONFIRM_TITLE: React.CSSProperties = {
  fontSize:   14,
  fontWeight: 600,
  marginBottom: 6,
};

const CONFIRM_BODY: React.CSSProperties = {
  fontSize:    12,
  color:       '#bdbdc0',
  marginBottom: 14,
  lineHeight:  1.4,
};

const CONFIRM_ROW: React.CSSProperties = {
  display: 'flex',
  gap:     8,
};

const CONFIRM_BTN: React.CSSProperties = {
  background:   'rgba(255,255,255,0.1)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '6px 10px',
  borderRadius: 4,
  cursor:       'pointer',
  fontSize:     12,
  flex:         1,
};

const EMPTY_ENTRIES: ScriptErrorEntry[] = [];

export function ScriptEditorModal({ source, onChange, onSave, onRun, getSavedSource, errorLog }: Props) {
  const centerAnchor              = useAnchorTarget('center');
  const [open, setOpen]           = useState(false);
  const [running, setRunning]     = useState(false);
  // When set, an inline confirm overlay covers the dialog body. The host
  // chose to close while dirty; clearing this either closes or cancels.
  const [confirmingClose, setConfirmingClose] = useState(false);

  const entries = useScriptErrorLog(errorLog ?? null);

  // Run failures (compile / module-load / structural / constructor / hook)
  // funnel through the unified error log via ScriptHost. The result.error
  // value is intentionally not surfaced separately — the same error has
  // already become a log entry by the time runScript resolves.
  const handleRun = async () => {
    setRunning(true);
    try {
      await onRun(source);
    } finally {
      setRunning(false);
    }
  };

  // Close interceptor. Radix calls this for Esc, X, and outside-click. If
  // the live source matches the runtime's persisted source, close cleanly;
  // otherwise show the confirm overlay.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    if (source !== getSavedSource()) {
      setConfirmingClose(true);
      return;
    }
    setOpen(false);
  };

  const closeImmediately = () => {
    setConfirmingClose(false);
    setOpen(false);
  };

  const handleSaveAndClose = () => {
    onSave();
    closeImmediately();
  };

  const handleDiscardAndClose = () => {
    onChange(getSavedSource());
    closeImmediately();
  };

  const handleCancelClose = () => {
    setConfirmingClose(false);
  };

  return (
    <>
      <button type="button" style={TRIGGER_BTN} onClick={() => setOpen(true)}>
        Edit Script
      </button>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal container={centerAnchor ?? undefined}>
          <Dialog.Overlay style={OVERLAY} />
          <Dialog.Content style={CONTENT} aria-describedby={undefined}>
            <div style={HEADER}>
              <Dialog.Title style={TITLE}>Script Editor</Dialog.Title>
              <Dialog.Close asChild>
                <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
              </Dialog.Close>
            </div>
            <div style={BODY}>
              <textarea
                style={TEXTAREA}
                value={source}
                spellCheck={false}
                onChange={e => onChange(e.target.value)}
                placeholder="export default class extends Game { onScriptLoaded() { console.log('hi') } }"
              />
              <div style={BUTTON_ROW}>
                <button type="button" style={BUTTON} onClick={onSave}>Save Script</button>
                <button type="button" style={BUTTON} onClick={handleRun} disabled={running}>
                  {running ? 'Running…' : 'Run Script'}
                </button>
              </div>
              {errorLog && (
                <ErrorLogList entries={entries} onClear={() => errorLog.clear()} />
              )}
            </div>
            {confirmingClose && (
              <CloseConfirm
                onSave={handleSaveAndClose}
                onDiscard={handleDiscardAndClose}
                onCancel={handleCancelClose}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

interface CloseConfirmProps {
  onSave:    () => void;
  onDiscard: () => void;
  onCancel:  () => void;
}

function CloseConfirm({ onSave, onDiscard, onCancel }: CloseConfirmProps) {
  return (
    <div style={CONFIRM_BACKDROP} role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <div style={CONFIRM_BOX}>
        <div style={CONFIRM_TITLE}>Unsaved changes</div>
        <div style={CONFIRM_BODY}>
          You have unsaved edits. Save them, discard them, or stay in the editor.
        </div>
        <div style={CONFIRM_ROW}>
          <button type="button" style={CONFIRM_BTN} onClick={onSave}>Save &amp; close</button>
          <button type="button" style={CONFIRM_BTN} onClick={onDiscard}>Discard &amp; close</button>
          <button type="button" style={CONFIRM_BTN} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ErrorLogList({
  entries, onClear,
}: { entries: ScriptErrorEntry[]; onClear: () => void }) {
  return (
    <div style={LOG_LIST}>
      <div style={LOG_HEADER}>
        <span style={LOG_LABEL}>Script errors ({entries.length})</span>
        <button type="button" style={LOG_CLEAR} onClick={onClear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <div style={{ color: '#666', fontSize: 11 }}>No script errors.</div>
      ) : (
        // Newest at top — matches typical log UX.
        [...entries].reverse().map((e, i) => (
          <div key={`${e.timestamp}-${i}`} style={entryStyle(e.source)}>
            <div style={LOG_META}>
              <span style={badgeStyle(e.source)}>{badgeLabel(e.source)}</span>
              {formatTime(e.timestamp)} · {e.source}
            </div>
            <div>{e.firstLine}</div>
          </div>
        ))
      )}
    </div>
  );
}

function entryStyle(source: string): React.CSSProperties {
  if (source === 'compile') return LOG_ENTRY_COMPILE;
  return LOG_ENTRY;
}

function badgeStyle(source: string): React.CSSProperties {
  if (source === 'compile') return BADGE_COMPILE;
  if (source.startsWith('event:')) return BADGE_EVENT;
  return BADGE_HOOK;
}

function badgeLabel(source: string): string {
  if (source === 'compile') return 'compile';
  if (source === 'constructor') return 'constructor';
  if (source.startsWith('event:')) return 'event';
  return 'hook';
}

function useScriptErrorLog(log: ScriptErrorLog | null): ScriptErrorEntry[] {
  const [entries, setEntries] = useState<ScriptErrorEntry[]>(() => log?.list() ?? EMPTY_ENTRIES);
  useEffect(() => {
    if (!log) {
      setEntries(EMPTY_ENTRIES);
      return;
    }
    setEntries(log.list());
    return log.subscribe(() => setEntries(log.list()));
  }, [log]);
  return entries;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
