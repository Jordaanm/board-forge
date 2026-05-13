// Host-only one-time script Console panel. Lets the host type ad-hoc TS
// against the live `scene` and active `game` instance for setup tweaks,
// debugging, and inspections. Runs each input in a fresh SES Compartment
// via `ScriptHost.runOneShot`; no persistence between runs.
//
// Editor reuses the lazy-loaded Monaco wrapper from ScriptEditorModal but
// with a distinct model path so cursor/undo state is independent of the
// main editor. Output pane shows captured console.* lines, the awaited
// return value (use `return X` to surface one), and any thrown error.

import { lazy, Suspense, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type OneShotResult } from '../scripting/ScriptHost';
import { type LogLine, type LogLevel } from '../scripting/ConsoleSandbox';
import { useAnchorTarget } from './AnchorLayout';
import { ScriptEditorErrorBoundary } from './ScriptEditorErrorBoundary';

const ScriptEditor = lazy(() => import('./ScriptEditor'));

let editorPreloadStarted = false;
function preloadScriptEditor(): void {
  if (editorPreloadStarted) return;
  editorPreloadStarted = true;
  void import('./ScriptEditor');
}

interface Props {
  // When null, the trigger button is disabled — there's no ScriptHost
  // (guest seat or before world init).
  onRun:         ((source: string) => Promise<OneShotResult>) | null;
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

const TRIGGER_BTN_DISABLED: React.CSSProperties = {
  ...TRIGGER_BTN,
  opacity: 0.45,
  cursor:  'not-allowed',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.45)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  position:      'relative',
  width:         '90vw',
  maxWidth:      1200,
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
  background: 'none', border: 'none', color: 'var(--ink-mute)',
  cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
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
  flex:           '1 1 auto',
  minHeight:      180,
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  background:     'var(--bg)',
  border:         '1px solid var(--line-strong)',
  color:          'var(--ink-mute)',
  borderRadius:   3,
  fontSize:       12,
};

const BUTTON_ROW: React.CSSProperties = { display: 'flex', gap: 8, flexShrink: 0 };

const BUTTON: React.CSSProperties = {
  background:   'var(--surface-2)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '8px 14px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontSize:     13,
};

const BUTTON_PRIMARY: React.CSSProperties = {
  ...BUTTON,
  flex: 1,
};

const OUTPUT_PANE: React.CSSProperties = {
  flex:         '1 1 35%',
  minHeight:    140,
  overflowY:    'auto',
  borderTop:    '1px solid var(--line)',
  paddingTop:   8,
  fontFamily:   'var(--font-mono)',
  fontSize:     12,
};

const OUTPUT_HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  marginBottom:   6,
  fontFamily:     'var(--font-sans)',
};

const OUTPUT_LABEL: React.CSSProperties = {
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:         'var(--ink-mute)',
};

const CLEAR_BTN: React.CSSProperties = {
  background:   'none',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink-2)',
  padding:      '2px 8px',
  borderRadius: 3,
  cursor:       'pointer',
  fontSize:     11,
};

const LINE: React.CSSProperties = {
  whiteSpace:   'pre-wrap',
  wordBreak:    'break-word',
  padding:      '3px 6px',
  borderRadius: 3,
  marginBottom: 2,
};

const LEVEL_STYLE: Record<LogLevel, React.CSSProperties> = {
  log:   { ...LINE, color: 'var(--ink)' },
  info:  { ...LINE, color: 'var(--accent-deep)', background: 'color-mix(in oklab, var(--accent) 8%, transparent)' },
  warn:  { ...LINE, color: 'var(--gold)', background: 'color-mix(in oklab, var(--gold) 10%, transparent)' },
  error: { ...LINE, color: 'var(--accent-deep)', background: 'color-mix(in oklab, var(--accent) 10%, transparent)' },
  debug: { ...LINE, color: 'var(--moss)' },
};

const RESULT_LINE: React.CSSProperties = {
  ...LINE,
  color:      'var(--moss)',
  background: 'color-mix(in oklab, var(--moss) 10%, transparent)',
  border:     '1px solid color-mix(in oklab, var(--moss) 30%, transparent)',
};

const ERROR_LINE: React.CSSProperties = {
  ...LINE,
  color:      'var(--accent-deep)',
  background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
  border:     '1px solid color-mix(in oklab, var(--accent) 30%, transparent)',
};

const LEVEL_BADGE: React.CSSProperties = {
  display:       'inline-block',
  padding:       '0 5px',
  borderRadius:  3,
  fontSize:      9,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontWeight:    600,
  marginRight:   6,
  background:    'var(--surface-2)',
  color:         'var(--ink-2)',
};

const SEED_SOURCE = `// One-time script. Runs against the live scene + game instance.
// Use \`return X\` to surface a value, or \`console.log(...)\` lines.
//
// Listeners added here are NOT cleaned up when this run ends.
//
// Examples:
//   return scene.getTable()?.id;
//   game?.onTurnEndRequested(0);
`;

interface OutputState {
  // null = no run yet. Either logs+result or logs+error.
  result: OneShotResult | null;
}

export function ScriptConsoleModal({ onRun, open: controlledOpen, onOpenChange, hideTrigger }: Props) {
  const centerAnchor          = useAnchorTarget('center');
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [source, setSource]   = useState(SEED_SOURCE);
  const [running, setRunning] = useState(false);
  const [output, setOutput]   = useState<OutputState>({ result: null });

  const handleRun = async () => {
    if (running || !onRun) return;
    setRunning(true);
    try {
      const result = await onRun(source);
      setOutput({ result });
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => setOutput({ result: null });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      void handleRun();
    }
  };

  const disabled = onRun === null;

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          style={disabled ? TRIGGER_BTN_DISABLED : TRIGGER_BTN}
          onClick={() => setOpen(true)}
          disabled={disabled}
          onMouseEnter={preloadScriptEditor}
          onFocus={preloadScriptEditor}
        >
          Console
        </button>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal container={centerAnchor ?? undefined}>
          <Dialog.Overlay style={OVERLAY} />
          <Dialog.Content style={CONTENT} aria-describedby={undefined} onKeyDown={handleKeyDown}>
            <div style={HEADER}>
              <Dialog.Title style={TITLE}>Console (one-time script)</Dialog.Title>
              <Dialog.Close asChild>
                <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
              </Dialog.Close>
            </div>
            <div style={BODY}>
              <ScriptEditorErrorBoundary source={source} onChange={setSource}>
                <Suspense fallback={<div style={EDITOR_LOADING}>Loading editor…</div>}>
                  <ScriptEditor
                    source={source}
                    onChange={setSource}
                    onSave={() => { /* no save in console — Ctrl+S is a no-op */ }}
                    onRun={() => void handleRun()}
                    modelPath="console-one-shot.ts"
                  />
                </Suspense>
              </ScriptEditorErrorBoundary>
              <div style={BUTTON_ROW}>
                <button type="button" style={BUTTON_PRIMARY} onClick={handleRun} disabled={running || disabled}>
                  {running ? 'Running…' : 'Run (Ctrl+Enter)'}
                </button>
              </div>
              <OutputPane output={output} onClear={handleClear} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function OutputPane({ output, onClear }: { output: OutputState; onClear: () => void }) {
  const r = output.result;
  const isEmpty = r === null;
  return (
    <div style={OUTPUT_PANE}>
      <div style={OUTPUT_HEADER}>
        <span style={OUTPUT_LABEL}>Output</span>
        <button type="button" style={CLEAR_BTN} onClick={onClear} disabled={isEmpty}>
          Clear
        </button>
      </div>
      {isEmpty && <div style={{ color: 'var(--ink-mute)', fontSize: 11 }}>No output yet. Run a script to see logs + return value.</div>}
      {r && r.logs.map((log, i) => <LogRow key={i} log={log} />)}
      {r && r.ok && r.returnValue !== null && (
        <div style={RESULT_LINE}>
          <span style={LEVEL_BADGE}>result</span>
          {r.returnValue}
        </div>
      )}
      {r && !r.ok && (
        <div style={ERROR_LINE}>
          <span style={LEVEL_BADGE}>error</span>
          {r.error}
        </div>
      )}
    </div>
  );
}

function LogRow({ log }: { log: LogLine }) {
  return (
    <div style={LEVEL_STYLE[log.level]}>
      <span style={LEVEL_BADGE}>{log.level}</span>
      {log.text}
    </div>
  );
}
