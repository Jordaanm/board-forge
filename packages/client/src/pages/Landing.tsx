import { useEffect, useState } from 'react';
import './Landing.css';

const API_URL = 'http://localhost:3001';

interface RoomInfo {
  roomId:    string;
  occupancy: number;
}

export function Landing() {
  const [rooms,   setRooms]   = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${API_URL}/rooms`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setRooms(d.rooms ?? []); })
        .catch(() => { /* ignore */ })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const createRoom = () => {
    const roomId = crypto.randomUUID();
    window.location.href = `${window.location.origin}/?room=${roomId}&host=1`;
  };

  return (
    <div className="landing">
      <div className="landing__card">
        <h1 className="landing__title">Virtual Table</h1>
        <p className="landing__subtitle">A real-time physics sandbox for tabletop games</p>
        <button className="landing__create-btn" onClick={createRoom}>Create Room</button>

        <div className="landing__rooms">
          <h2 className="landing__rooms-title">Open Rooms</h2>
          {loading ? (
            <p className="landing__muted">Loading...</p>
          ) : rooms.length === 0 ? (
            <p className="landing__muted">No open rooms</p>
          ) : (
            <ul className="landing__list">
              {rooms.map(r => (
                <li key={r.roomId} className="landing__row">
                  <span className="landing__room-id">{r.roomId.slice(0, 8)}</span>
                  <span className="landing__occupancy">
                    {r.occupancy} {r.occupancy === 1 ? 'player' : 'players'}
                  </span>
                  <a className="landing__join-btn" href={`${window.location.origin}/?room=${r.roomId}`}>
                    Join
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
