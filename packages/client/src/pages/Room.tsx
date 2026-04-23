import { useEffect, useRef, useState } from 'react';
import { ThreeCanvas } from '../ThreeCanvas';
import { ConnectionManager } from '../net/ConnectionManager';
import { SpawnPanel } from '../components/SpawnPanel';
import { ContextMenu } from '../components/ContextMenu';
import { type ContextMenuRequest } from '../input/ContextMenuController';
import { type ChannelMessage, type SpawnableType } from '../net/SceneState';

type Status = 'connecting' | 'connected' | 'disconnected' | 'room-full';

const SIGNALING_URL = 'ws://localhost:3001';

const STATUS_LABEL: Record<Status, string> = {
  connecting:   'Waiting for peer...',
  connected:    'Connected',
  disconnected: 'Disconnected',
  'room-full':  'Room is full',
};

const STATUS_COLOR: Record<Status, string> = {
  connecting:   '#aaa',
  connected:    '#4caf50',
  disconnected: '#f44336',
  'room-full':  '#f44336',
};

interface Props {
  roomId: string;
  isHost: boolean;
}

const noop = () => {};

export function Room({ roomId, isHost }: Props) {
  const [status,      setStatus]      = useState<Status>('connecting');
  const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);

  const sendRef          = useRef<(msg: ChannelMessage) => void>(noop);
  const onMsgRef         = useRef<(msg: ChannelMessage) => void>(noop);
  const spawnRef         = useRef<(type: SpawnableType) => void>(noop);
  const rollRef          = useRef<() => void>(noop);
  const onContextMenuRef = useRef<(req: ContextMenuRequest) => void>(noop);
  const rollObjectRef    = useRef<(id: string) => void>(noop);
  const deleteObjectRef  = useRef<(id: string) => void>(noop);

  // Set every render — fine, it's just a ref assignment.
  onContextMenuRef.current = (req) => setContextMenu(req);

  useEffect(() => {
    const mgr = new ConnectionManager(
      (msg) => onMsgRef.current(msg as ChannelMessage),
      (s)   => setStatus(s as Status),
    );
    sendRef.current = (msg) => mgr.send(msg);

    if (isHost) mgr.hostRoom(SIGNALING_URL, roomId);
    else        mgr.joinRoom(SIGNALING_URL, roomId);

    return () => {
      mgr.dispose();
      sendRef.current = noop;
    };
  }, [roomId, isHost]);

  const handleContextAction = (actionId: string, objectId: string) => {
    if (actionId === 'roll')   rollObjectRef.current(objectId);
    if (actionId === 'delete') deleteObjectRef.current(objectId);
  };

  const shareUrl = (() => {
    const u = new URL(window.location.href);
    u.searchParams.delete('host');
    return u.toString();
  })();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ThreeCanvas
        isHost={isHost}
        sendRef={sendRef}
        onMsgRef={onMsgRef}
        spawnRef={spawnRef}
        rollRef={rollRef}
        onContextMenuRef={onContextMenuRef}
        rollObjectRef={rollObjectRef}
        deleteObjectRef={deleteObjectRef}
      />

      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(0,0,0,0.65)', color: STATUS_COLOR[status],
        padding: '6px 14px', borderRadius: 6, fontSize: 13,
        fontFamily: 'sans-serif', fontWeight: 600,
      }}>
        {STATUS_LABEL[status]}
      </div>

      {isHost && (
        <SpawnPanel
          onSpawn={(t) => spawnRef.current(t)}
          onRollDice={() => rollRef.current()}
        />
      )}

      {isHost && status === 'connecting' && (
        <div style={{
          position: 'absolute', bottom: 72, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', color: '#e8e8e8',
          padding: '14px 22px', borderRadius: 8, fontFamily: 'sans-serif',
          textAlign: 'center', maxWidth: 480,
        }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#aaa' }}>
            Share this link with your guest:
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: '#5c7cfa' }}>
            {shareUrl}
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onAction={handleContextAction}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
