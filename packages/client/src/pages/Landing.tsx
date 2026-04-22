const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', background: '#1a1a2e', color: '#e8e8e8',
    fontFamily: 'sans-serif',
  },
  card: { textAlign: 'center' },
  h1: { fontSize: 36, fontWeight: 700, marginBottom: 8, letterSpacing: 1 },
  sub: { fontSize: 14, color: '#888', marginBottom: 32 },
  btn: {
    padding: '12px 32px', fontSize: 16, fontWeight: 600,
    background: '#5c7cfa', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  },
};

export function Landing() {
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
      </div>
    </div>
  );
}
