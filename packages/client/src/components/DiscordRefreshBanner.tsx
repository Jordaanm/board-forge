// Non-blocking notice at the top of the viewport. Renders only after a
// silent refresh has rejected and the user still has a (now-stale) signed-in
// profile. Sign-out or a successful sign-in clears the flag in the provider
// and unmounts the banner.

import { useDiscordAuth } from '../discord/DiscordAuthProvider';

const BANNER: React.CSSProperties = {
  position:     'fixed',
  top:          12,
  left:         '50%',
  transform:    'translateX(-50%)',
  zIndex:       300,
  background:   'var(--surface)',
  border:       '1px solid var(--accent-deep)',
  borderRadius: 'var(--panel-radius)',
  boxShadow:    'var(--shadow-lg)',
  color:        'var(--ink)',
  fontFamily:   'var(--font-sans)',
  fontSize:     13,
  padding:      '10px 14px',
  display:      'flex',
  alignItems:   'center',
  gap:          12,
};

const BTN: React.CSSProperties = {
  background:   'var(--accent)',
  color:        'var(--accent-ink)',
  border:       '1px solid var(--accent-deep)',
  borderRadius: 'var(--card-radius)',
  padding:      '6px 12px',
  cursor:       'pointer',
  fontFamily:   'inherit',
  fontSize:     13,
  fontWeight:   700,
};

export function DiscordRefreshBanner() {
  const { refreshFailed, isSignedIn, signIn } = useDiscordAuth();
  if (!refreshFailed || !isSignedIn) return null;
  return (
    <div role="status" aria-live="polite" style={BANNER}>
      <span>Discord session expired — sign in again</span>
      <button type="button" style={BTN} onClick={() => { void signIn(); }}>Sign in</button>
    </div>
  );
}
