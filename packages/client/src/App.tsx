import { useEffect } from 'react';
import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import { PreferencesProvider } from './preferences/PreferencesContext';
import { usePreferences } from './preferences/usePreferences';

function parseUrl() {
  const p = new URLSearchParams(window.location.search);
  const roomId = p.get('room');
  const isHost = p.has('host');
  return { roomId, isHost };
}

function ThemeBinder() {
  const { resolvedTheme } = usePreferences();
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [resolvedTheme]);
  return null;
}

export function App() {
  const { roomId, isHost } = parseUrl();
  return (
    <PreferencesProvider>
      <ThemeBinder/>
      {roomId ? <Room roomId={roomId} isHost={isHost} /> : <Landing />}
    </PreferencesProvider>
  );
}
