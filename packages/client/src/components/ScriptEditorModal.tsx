import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type RunResult } from '../scripting/ScriptHost';
import { type ScriptErrorLog, type ScriptErrorEntry } from '../scripting/ScriptErrorLog';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  source:    string;
  onChange:  (next: string) => void;
  onSave:    () => void;
  onRun:     (source: string) => Promise<RunResult>;
  errorLog?: ScriptErrorLog | null;
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

const ERROR_BLOCK: React.CSSProperties = {
  padding:      '6px 8px',
  background:   'rgba(220,80,80,0.15)',
  border:       '1px solid rgba(220,80,80,0.4)',
  borderRadius: 3,
  color:        '#ffb0b0',
  fontFamily:   'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize:     11,
  whiteSpace:   'pre-wrap',
  flexShrink:   0,
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

const LOG_META: React.CSSProperties = {
  color:    '#888',
  fontSize: 10,
};

const EMPTY_ENTRIES: ScriptErrorEntry[] = [];

export function ScriptEditorModal({ source, onChange, onSave, onRun, errorLog }: Props) {
  const centerAnchor          = useAnchorTarget('center');
  const [open, setOpen]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const entries = useScriptErrorLog(errorLog ?? null);

  useEffect(() => {
    if (entries.length > 0) setError(null);
  }, [entries.length]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await onRun(source);
      if (!result.ok) setError(result.error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button type="button" style={TRIGGER_BTN} onClick={() => setOpen(true)}>
        Edit Script
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
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
              {error && <div style={ERROR_BLOCK}>{error}</div>}
              {errorLog && (
                <ErrorLogList entries={entries} onClear={() => errorLog.clear()} />
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ErrorLogList({
  entries, onClear,
}: { entries: ScriptErrorEntry[]; onClear: () => void }) {
  return (
    <div style={LOG_LIST}>
      <div style={LOG_HEADER}>
        <span style={LOG_LABEL}>Runtime errors ({entries.length})</span>
        <button type="button" style={LOG_CLEAR} onClick={onClear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <div style={{ color: '#666', fontSize: 11 }}>No runtime errors.</div>
      ) : (
        entries.map((e, i) => (
          <div key={`${e.timestamp}-${i}`} style={LOG_ENTRY}>
            <div style={LOG_META}>
              {formatTime(e.timestamp)} · {e.source}
            </div>
            <div>{e.firstLine}</div>
          </div>
        ))
      )}
    </div>
  );
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
