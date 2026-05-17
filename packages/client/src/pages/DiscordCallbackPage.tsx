import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDiscordAuth } from '../discord/DiscordAuthProvider';

type State = 'running' | 'error';

export function DiscordCallbackPage() {
  const [search]                = useSearchParams();
  const navigate                = useNavigate();
  const { completeCallback }    = useDiscordAuth();
  const [state, setState]       = useState<State>('running');
  const [errorMsg, setErrorMsg] = useState<string>('');
  // React StrictMode double-mounts effects — guard so we don't fire the
  // single-use auth code through the exchange twice.
  const ran                     = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code        = search.get('code');
    const stateParam  = search.get('state');
    const errorParam  = search.get('error');

    if (errorParam !== null) {
      setErrorMsg(errorParam);
      setState('error');
      return;
    }
    if (code === null || stateParam === null) {
      setErrorMsg('missing_parameters');
      setState('error');
      return;
    }

    completeCallback(code, stateParam)
      .then(returnUrl => {
        // Decoded returnUrl was the full window.location.href at sign-in. Use
        // pathname + search + hash so react-router stays in-app, avoiding a
        // full reload (which would drop the freshly populated in-memory token
        // store / profile context).
        try {
          const url = new URL(returnUrl, window.location.origin);
          navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true });
        } catch {
          navigate('/', { replace: true });
        }
      })
      .catch(err => {
        console.error('[discord-callback]', err);
        setErrorMsg(err instanceof Error ? err.message : 'unknown_error');
        setState('error');
      });
  }, [search, completeCallback, navigate]);

  if (state === 'error') {
    return (
      <div style={CONTAINER}>
        <h1 style={TITLE}>Sign-in failed</h1>
        <p style={MUTED}>Discord couldn't complete the sign-in: <code>{errorMsg}</code></p>
        <button style={BTN} type="button" onClick={() => navigate('/', { replace: true })}>
          Back to Landing
        </button>
      </div>
    );
  }

  return (
    <div style={CONTAINER}>
      <h1 style={TITLE}>Signing you in…</h1>
      <p style={MUTED}>Finishing Discord sign-in.</p>
    </div>
  );
}

const CONTAINER: React.CSSProperties = {
  display:        'flex',
  flexDirection:  'column',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            12,
  minHeight:      '100vh',
  fontFamily:     'var(--font-sans)',
  color:          'var(--ink)',
  background:     'var(--bg)',
  padding:        24,
};

const TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontWeight: 600,
  fontSize:   24,
  margin:     0,
};

const MUTED: React.CSSProperties = {
  color:    'var(--ink-mute)',
  fontSize: 13,
  margin:   0,
};

const BTN: React.CSSProperties = {
  background:   'var(--accent)',
  color:        'var(--accent-ink)',
  border:       '1px solid var(--accent-deep)',
  padding:      '8px 16px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontFamily:   'inherit',
  fontWeight:   700,
};
