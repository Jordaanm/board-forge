// Catches Monaco load/init failures and renders a degraded textarea so
// the host is never blocked from editing. Fires when:
//   - dynamic import of ScriptEditor fails (network, deploy skew)
//   - Monaco throws on first mount (unexpected SES interaction etc.)
//
// Rendering a real textarea keeps Save / Run / dirty-tracking working
// against the same `source` / `onChange` props the editor would have used.

import { Component, type ReactNode } from 'react';

const FALLBACK_WRAP: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  flex:          '1 1 auto',
  minHeight:     220,
  gap:           6,
};

const FALLBACK_NOTICE: React.CSSProperties = {
  padding:      '6px 8px',
  background:   'rgba(220,140,80,0.15)',
  border:       '1px solid rgba(220,140,80,0.40)',
  borderRadius: 3,
  color:        '#ffe0c0',
  fontSize:     11,
  flexShrink:   0,
};

const FALLBACK_TEXTAREA: React.CSSProperties = {
  flex:          '1 1 auto',
  minHeight:     180,
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

interface Props {
  source:   string;
  onChange: (next: string) => void;
  children: ReactNode;
}

interface State {
  errored: boolean;
}

export class ScriptEditorErrorBoundary extends Component<Props, State> {
  state: State = { errored: false };

  static getDerivedStateFromError(): State {
    return { errored: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface for ops visibility — the user already sees the textarea
    // fallback, but the console gives a hook for diagnostics.
    // eslint-disable-next-line no-console
    console.error('[ScriptEditor] failed to load — falling back to textarea:', error);
  }

  render() {
    if (this.state.errored) {
      return (
        <div style={FALLBACK_WRAP}>
          <div style={FALLBACK_NOTICE}>
            Editor failed to load — using plain textarea. Reload the page to retry.
          </div>
          <textarea
            style={FALLBACK_TEXTAREA}
            value={this.props.source}
            spellCheck={false}
            onChange={(e) => this.props.onChange(e.target.value)}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
