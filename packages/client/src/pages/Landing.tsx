import { useEffect, useState } from 'react';
import './Landing.css';

const API_URL = 'http://localhost:3001';

interface RoomInfo {
  roomId:    string;
  occupancy: number;
}

const IconUsers = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.2"/>
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
    <circle cx="17" cy="9" r="2.6"/>
    <path d="M15 14c2.8 0 5 2.2 5 5"/>
  </svg>
);

const IconChevronR = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6"/>
  </svg>
);

export function Landing() {
  const [rooms,        setRooms]        = useState<RoomInfo[]>([]);
  const [totalTables,  setTotalTables]  = useState(0);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${API_URL}/rooms`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          setRooms(d.rooms ?? []);
          setTotalTables(d.totalRoomsCreated ?? 0);
        })
        .catch(() => { /* ignore */ })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const playersOnline = rooms.reduce((sum, r) => sum + r.occupancy, 0);
  const openRooms     = rooms.length;

  const createRoom = () => {
    const roomId = crypto.randomUUID();
    window.location.href = `${window.location.origin}/?room=${roomId}&host=1`;
  };

  return (
    <div className="landing">
      <div className="landing__card">
        <h1 className="landing__title">Board Together</h1>
        <p className="landing__subtitle">Right Now. Over the web.</p>
        <button className="landing__create-btn" onClick={createRoom}>Create Room</button>

        <div className="landing__stats">
          <div className="landing__stat">
            <b>{playersOnline.toLocaleString()}</b>
            <span>players online</span>
          </div>
          <div className="landing__stat-sep"/>
          <div className="landing__stat">
            <b>{openRooms.toLocaleString()}</b>
            <span>open rooms</span>
          </div>
          <div className="landing__stat-sep"/>
          <div className="landing__stat">
            <b>{totalTables.toLocaleString()}</b>
            <span>total tables</span>
          </div>
        </div>

        <div className="landing__rooms">
          <h2 className="landing__rooms-title">Open Rooms</h2>
          {loading ? (
            <p className="landing__muted">Loading...</p>
          ) : rooms.length === 0 ? (
            <p className="landing__muted">No open rooms</p>
          ) : (
            <div className="landing__rooms-grid">
              {rooms.map(r => (
                <a key={r.roomId} className="landing__room-card"
                   href={`${window.location.origin}/?room=${r.roomId}`}>
                  <div className="landing__room-top">
                    <span className="landing__room-id">{r.roomId.slice(0, 8)}</span>
                    <span className="landing__chip"><span className="landing__chip-dot"/>Open</span>
                  </div>
                  <div className="landing__room-meta">
                    <span className="landing__room-stat">
                      <IconUsers/> {r.occupancy} {r.occupancy === 1 ? 'player' : 'players'}
                    </span>
                  </div>
                  <div className="landing__room-foot">
                    <div className="landing__seats">
                      {Array.from({ length: Math.max(r.occupancy, 1) }, (_, i) => (
                        <span key={i}
                              className={`landing__seat ${i < r.occupancy ? 'landing__seat--on' : ''}`}/>
                      ))}
                    </div>
                    <span className="landing__join-cta">Join <IconChevronR/></span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
