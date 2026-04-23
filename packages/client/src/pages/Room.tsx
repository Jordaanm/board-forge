import { useEffect, useRef, useState } from 'react';
import { ThreeCanvas } from '../ThreeCanvas';
import { ConnectionManager } from '../net/ConnectionManager';
import type { GameMessage } from '../net/SceneState';

type Status = 'connecting' | 'connected' | 'disconnected' | 'room-full';

const SIGNALING_URL = 'ws://localhost:3001';

const STATUS_LABEL: Record<Status, string> = {
  connecting: 'Waiting for peer...',
  connected: 'Connected',
  disconnected: 'Disconnected',
  'room-full': 'Room is full',
};

const STATUS_COLOR: Record<Status, string> = {
  connecting: '#aaa',
  connected: '#4caf50',
  disconnected: '#f44336',
  'room-full': '#f44336',
};

interface Props {
  roomId: string;
  isHost: boolean;
}

// Stable no-op so refs always hold a callable function.
const noop = () => {};

export function Room({ roomId, isHost }: Props) {
  const [status, setStatus] = useState<Status>('connecting');

  // Stable refs — .current is swapped when the connection changes, never the ref itself.
  const sendRef  = useRef<(msg: GameMessage) => void>(noop);
  const onMsgRef = useRef<(msg: GameMessage) => void>(noop);

  useEffect(() => {
    const mgr = new ConnectionManager(
      (msg) => onMsgRef.current(msg as GameMessage),
      (s) => setStatus(s as Status),
    );
    sendRef.current = (msg) => mgr.send(msg);

    if (isHost) mgr.hostRoom(SIGNALING_URL, roomId);
    else mgr.joinRoom(SIGNALING_URL, roomId);

    return () => {
      mgr.dispose();
      sendRef.current = noop;
    };
  }, [roomId, isHost]);

  const shareUrl = (() => {
    const u = new URL(window.location.href);
    u.searchParams.delete('host');
    return u.toString();
  })();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ThreeCanvas isHost={isHost} sendRef={sendRef} onMsgRef={onMsgRef} />

      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(0,0,0,0.65)', color: STATUS_COLOR[status],
        padding: '6px 14px', borderRadius: 6, fontSize: 13,
        fontFamily: 'sans-serif', fontWeight: 600,
      }}>
        {STATUS_LABEL[status]}
      </div>

      {isHost && status === 'connecting' && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', color: '#e8e8e8',
          padding: '14px 22px', borderRadius: 8, fontFamily: 'sans-serif',
          textAlign: 'center', maxWidth: 480,
        }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#aaa' }}>
            Share this link with your guest:
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 12,
            wordBreak: 'break-all', color: '#5c7cfa',
          }}>
            {shareUrl}
          </div>
        </div>
      )}
    </div>
  );
}
