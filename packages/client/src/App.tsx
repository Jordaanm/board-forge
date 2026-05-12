import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import { PreferencesProvider } from './preferences/PreferencesContext';

function parseUrl() {
  const p = new URLSearchParams(window.location.search);
  const roomId = p.get('room');
  const isHost = p.has('host');
  return { roomId, isHost };
}

export function App() {
  const { roomId, isHost } = parseUrl();
  return (
    <PreferencesProvider>
      {roomId ? <Room roomId={roomId} isHost={isHost} /> : <Landing />}
    </PreferencesProvider>
  );
}
