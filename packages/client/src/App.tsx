import { Landing } from './pages/Landing';
import { Room } from './pages/Room';

function parseUrl() {
  const p = new URLSearchParams(window.location.search);
  const roomId = p.get('room');
  const isHost = p.has('host');
  return { roomId, isHost };
}

export function App() {
  const { roomId, isHost } = parseUrl();
  if (roomId) return <Room roomId={roomId} isHost={isHost} />;
  return <Landing />;
}
