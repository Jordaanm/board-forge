import { useEffect, useState } from 'react';

const API_URL = 'http://localhost:3001';

interface RoomInfo {
  roomId:    string;
  occupancy: number;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', background: '#1a1a2e', color: '#e8e8e8',
    fontFamily: 'sans-serif',
  },
  card: { textAlign: 'center', minWidth: 420 },
  h1: { fontSize: 36, fontWeight: 700, marginBottom: 8, letterSpacing: 1 },
  sub: { fontSize: 14, color: '#888', marginBottom: 32 },
  btn: {
    padding: '12px 32px', fontSize: 16, fontWeight: 600,
    background: '#5c7cfa', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  },
  rooms: { marginTop: 40, textAlign: 'left' },
  h2: {
    fontSize: 16, fontWeight: 600, color: '#aaa',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 12, textAlign: 'center',
  },
  muted: { color: '#666', fontSize: 14, textAlign: 'center' },
  list: { listStyle: 'none', padding: 0, margin: 0 },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#252538',
    borderRadius: 6, marginBottom: 6, fontSize: 14,
  },
  roomId: { fontFamily: 'monospace', color: '#e8e8e8' },
  occupancy: { color: '#aaa', fontSize: 13 },
  join: {
    padding: '6px 14px', background: '#5c7cfa', color: '#fff',
    borderRadius: 4, textDecoration: 'none', fontWeight: 600, fontSize: 13,
  },
};

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
    <div style={styles.root}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Virtual Table</h1>
        <p style={styles.sub}>A real-time physics sandbox for tabletop games</p>
        <button style={styles.btn} onClick={createRoom}>Create Room</button>

        <div style={styles.rooms}>
          <h2 style={styles.h2}>Open Rooms</h2>
          {loading ? (
            <p style={styles.muted}>Loading...</p>
          ) : rooms.length === 0 ? (
            <p style={styles.muted}>No open rooms</p>
          ) : (
            <ul style={styles.list}>
              {rooms.map(r => (
                <li key={r.roomId} style={styles.row}>
                  <span style={styles.roomId}>{r.roomId.slice(0, 8)}</span>
                  <span style={styles.occupancy}>
                    {r.occupancy} {r.occupancy === 1 ? 'player' : 'players'}
                  </span>
                  <a style={styles.join} href={`${window.location.origin}/?room=${r.roomId}`}>
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
