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
  background:   'color-mix(in oklab, var(--accent) 18%, transparent)',
  border:       '1px solid color-mix(in oklab, var(--accent) 40%, transparent)',
  borderRadius: 3,
  color:        'var(--accent-deep)',
  fontSize:     11,
  flexShrink:   0,
};

const FALLBACK_TEXTAREA: React.CSSProperties = {
  flex:          '1 1 auto',
  minHeight:     180,
  background:    'var(--bg)',
  border:        '1px solid var(--line)',
  color:         'var(--ink)',
  padding:       '8px 10px',
  borderRadius:  3,
  fontSize:      13,
  fontFamily:    'var(--font-mono)',
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
