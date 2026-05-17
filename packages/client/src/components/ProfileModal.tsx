// Minimal sign-in/out surface tied to DiscordAuthProvider. Display-name
// editing arrives in slice #4 — this slice only shows the avatar preview
// and the Sign in / Sign out button.

import * as Dialog from '@radix-ui/react-dialog';
import { useDiscordAuth } from '../discord/DiscordAuthProvider';
import { loadDisplayName } from '../identity/displayName';
import { useAnchorTarget } from './AnchorLayout';

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200,
};

const CONTENT: React.CSSProperties = {
  width:         360,
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
  background:     'var(--surface-2)',
};

const TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize:   17,
  fontWeight: 600,
  margin:     0,
  color:      'var(--ink)',
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none',
  border:     'none',
  color:      'var(--ink-mute)',
  cursor:     'pointer',
  fontSize:   20,
  lineHeight: 1,
  padding:    '0 4px',
};

const BODY: React.CSSProperties = {
  padding:       '20px 16px',
  display:       'flex',
  flexDirection: 'column',
  alignItems:    'center',
  gap:           14,
};

const AVATAR_LARGE: React.CSSProperties = {
  width:         84,
  height:        84,
  borderRadius:  '50%',
  display:       'flex',
  alignItems:    'center',
  justifyContent: 'center',
  background:    'var(--accent)',
  color:         'var(--accent-ink)',
  fontFamily:    'var(--font-serif)',
  fontSize:      32,
  fontWeight:    700,
  overflow:      'hidden',
  border:        '1px solid var(--accent-deep)',
};

const AVATAR_IMG: React.CSSProperties = {
  width: '100%', height: '100%', objectFit: 'cover',
};

const NAME_LINE: React.CSSProperties = {
  color:      'var(--ink)',
  fontSize:   15,
  fontWeight: 600,
  margin:     0,
};

const SUB_LINE: React.CSSProperties = {
  color:    'var(--ink-mute)',
  fontSize: 12,
  margin:   0,
};

const PRIMARY_BTN: React.CSSProperties = {
  background:   'var(--accent)',
  color:        'var(--accent-ink)',
  border:       '1px solid var(--accent-deep)',
  padding:      '8px 16px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontFamily:   'inherit',
  fontSize:     13,
  fontWeight:   700,
  width:        '100%',
};

const SECONDARY_BTN: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '8px 16px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontFamily:   'inherit',
  fontSize:     13,
  fontWeight:   700,
  width:        '100%',
};

export function ProfileModal({ open, onOpenChange }: Props) {
  const centerAnchor          = useAnchorTarget('center');
  const { profile, isSignedIn, signIn, signOut } = useDiscordAuth();
  const localName             = loadDisplayName();
  const initial               = (Array.from(localName.trim())[0] ?? '?').toUpperCase();

  const onSignIn  = () => { void signIn(); };
  const onSignOut = () => { signOut(); };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Profile</Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>
          <div style={BODY}>
            <div style={AVATAR_LARGE} title={localName}>
              {isSignedIn && profile?.avatarUrl
                ? <img src={profile.avatarUrl} alt="Discord avatar" style={AVATAR_IMG} />
                : initial}
            </div>
            <p style={NAME_LINE}>{localName}</p>
            {isSignedIn && profile
              ? <p style={SUB_LINE}>Signed in as <strong>{profile.displayNameSeed}</strong> on Discord</p>
              : <p style={SUB_LINE}>Not signed in</p>}

            {isSignedIn
              ? <button type="button" style={SECONDARY_BTN} onClick={onSignOut}>Sign out</button>
              : <button type="button" style={PRIMARY_BTN}   onClick={onSignIn}>Sign in with Discord</button>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
