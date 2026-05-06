import { useState } from 'react';
import { type RunResult } from '../scripting/ScriptHost';

interface Props {
  source:     string;
  onChange:   (next: string) => void;
  onSave:     () => void;
  onRun:      (source: string) => Promise<RunResult>;
}

const PANEL: React.CSSProperties = {
  width:        420,
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:        '#e8e8e8',
  fontFamily:   'sans-serif',
  fontSize:     13,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '8px 12px',
  borderBottom:   '1px solid rgba(255,255,255,0.1)',
  cursor:         'pointer',
  userSelect:     'none',
};

const SECTION: React.CSSProperties = {
  padding: '10px 12px',
};

const TEXTAREA: React.CSSProperties = {
  width:         '100%',
  minHeight:     220,
  background:    'rgba(0,0,0,0.4)',
  border:        '1px solid rgba(255,255,255,0.2)',
  color:         '#e8e8e8',
  padding:       '6px 8px',
  borderRadius:  3,
  fontSize:      12,
  fontFamily:    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  boxSizing:     'border-box',
  resize:        'vertical',
};

const BUTTON_ROW: React.CSSProperties = {
  display:       'flex',
  gap:           6,
  marginTop:     8,
};

const BUTTON: React.CSSProperties = {
  background:   'rgba(255,255,255,0.1)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '6px 10px',
  borderRadius: 4,
  cursor:       'pointer',
  fontSize:     12,
  flex:         1,
};

const ERROR_BLOCK: React.CSSProperties = {
  marginTop:     8,
  padding:       '6px 8px',
  background:    'rgba(220,80,80,0.15)',
  border:        '1px solid rgba(220,80,80,0.4)',
  borderRadius:  3,
  color:         '#ffb0b0',
  fontFamily:    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize:      11,
  whiteSpace:    'pre-wrap',
};

export function ScriptPanel({ source, onChange, onSave, onRun }: Props) {
  const [open, setOpen]           = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [running, setRunning]     = useState(false);

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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...PANEL, width: 'auto', padding: '6px 12px', cursor: 'pointer' }}
      >
        Open Script
      </button>
    );
  }

  return (
    <div style={PANEL}>
      <div style={HEADER} onClick={() => setCollapsed(c => !c)}>
        <span style={{ fontWeight: 600 }}>Script {collapsed ? '▸' : '▾'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}
          title="Close"
        >×</button>
      </div>

      {!collapsed && (
        <div style={SECTION}>
          <textarea
            style={TEXTAREA}
            value={source}
            spellCheck={false}
            onChange={e => onChange(e.target.value)}
            placeholder="export default class extends Game { onScriptLoaded() { console.log('hi') } }"
          />
          <div style={BUTTON_ROW}>
            <button style={BUTTON} onClick={onSave}>Save Script</button>
            <button
              style={BUTTON}
              onClick={handleRun}
              disabled={running}
            >
              {running ? 'Running…' : 'Run Script'}
            </button>
          </div>
          {error && <div style={ERROR_BLOCK}>{error}</div>}
        </div>
      )}
    </div>
  );
}
