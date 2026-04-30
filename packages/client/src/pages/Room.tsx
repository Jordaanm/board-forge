import { useEffect, useRef, useState } from 'react';
import { ThreeCanvas, type ReplicationTarget } from '../ThreeCanvas';
import { ConnectionManager } from '../net/ConnectionManager';
import { EditorPanel, type ObjectSummary } from '../components/EditorPanel';
import { ContextMenu } from '../components/ContextMenu';
import { type ContextMenuRequest } from '../input/ContextMenuController';
import { type ChannelMessage, type SpawnableType } from '../net/SceneState';
import { DEFAULT_TABLE_PROPS, type TableProps } from '../scene/Table';
import { RoomStateManager } from '../seats/RoomStateManager';
import { RoomStateClient } from '../seats/RoomStateClient';
import type { RoomStateMessage } from '../seats/RoomState';

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
  const [status,       setStatus]       = useState<Status>('connecting');
  const [contextMenu,  setContextMenu]  = useState<ContextMenuRequest | null>(null);
  const [objects,      setObjects]      = useState<ObjectSummary[]>([]);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [isFreeCamera, setIsFreeCamera] = useState(false);
  const [tableProps,   setTableProps]   = useState<TableProps>(DEFAULT_TABLE_PROPS);

  const sendRef            = useRef<(msg: ChannelMessage) => void>(noop);
  const sendToRef          = useRef<(peerId: string, msg: ChannelMessage) => void>(noop);
  const getTargetsRef      = useRef<() => ReplicationTarget[]>(() => []);
  const onMsgRef           = useRef<(peerId: string, msg: ChannelMessage) => void>(noop);
  const onPeerLeftRef      = useRef<(peerId: string) => void>(noop);
  const onPeerJoinedRef    = useRef<(peerId: string) => void>(noop);
  const spawnRef           = useRef<(type: SpawnableType) => void>(noop);
  const rollRef            = useRef<() => void>(noop);
  const onContextMenuRef   = useRef<(req: ContextMenuRequest) => void>(noop);
  const rollObjectRef      = useRef<(id: string) => void>(noop);
  const deleteObjectRef    = useRef<(id: string) => void>(noop);
  const updatePropRef      = useRef<(id: string, key: string, value: unknown) => void>(noop);
  const updateTablePropRef = useRef<(key: keyof TableProps, value: unknown) => void>(noop);
  const freeCameraRef      = useRef<(on: boolean) => void>(noop);
  const onObjectsChangeRef = useRef<(objs: ObjectSummary[]) => void>(noop);
  const onSelectRef        = useRef<(id: string | null) => void>(noop);
  const setHighlightRef    = useRef<(id: string | null) => void>(noop);

  // Set every render — fine, it's just a ref assignment.
  onContextMenuRef.current   = (req) => setContextMenu(req);
  onObjectsChangeRef.current = (objs) => setObjects(objs);
  onSelectRef.current        = (id) => setSelectedId(id);

  useEffect(() => {
    let manager: RoomStateManager | null = null;
    let client:  RoomStateClient  | null = null;
    let mgr!: ConnectionManager;

    mgr = new ConnectionManager(
      (peerId, msg) => {
        const m = msg as ChannelMessage;
        if (m.type === 'room-state') {
          client?.applySnapshot(m.snapshot);
          if (client) console.log('[RoomState] my seat:', client.getMySeat());
          return;
        }
        if (m.type === 'room-state-patch') {
          client?.applyPatch(m.patch);
          if (client) console.log('[RoomState] my seat:', client.getMySeat());
          return;
        }
        onMsgRef.current(peerId, m);
      },
      (s) => setStatus(s as Status),
      (peerId) => {
        manager?.removePeer(peerId);
        onPeerLeftRef.current(peerId);
      },
      (peerId) => {
        if (!manager) return;
        manager.assignOnJoin(peerId);
        const snapshotMsg: RoomStateMessage = { type: 'room-state', snapshot: manager.snapshot() };
        mgr.sendTo(peerId, snapshotMsg);
        onPeerJoinedRef.current(peerId);
      },
      (peerId) => {
        if (isHost) {
          manager = new RoomStateManager(peerId);
          manager.onChange((change) => {
            const patchMsg: RoomStateMessage = { type: 'room-state-patch', patch: change.patch };
            mgr.send(patchMsg);
          });
          console.log('[RoomState] my seat:', manager.getSeat(peerId));
        } else {
          client = new RoomStateClient(peerId);
        }
      },
    );
    sendRef.current     = (msg)         => mgr.send(msg);
    sendToRef.current   = (peerId, msg) => mgr.sendTo(peerId, msg);
    getTargetsRef.current = () => {
      if (!manager) return [];
      return mgr.getPeerIds().map(peerId => ({
        peerId,
        peerSeat: manager!.getSeat(peerId),
        isHost:   manager!.isHost(peerId),
      }));
    };

    if (isHost) mgr.hostRoom(SIGNALING_URL, roomId);
    else        mgr.joinRoom(SIGNALING_URL, roomId);

    return () => {
      mgr.dispose();
      sendRef.current       = noop;
      sendToRef.current     = noop;
      getTargetsRef.current = () => [];
    };
  }, [roomId, isHost]);

  // Clear selection if the selected object is removed
  useEffect(() => {
    if (selectedId && !objects.some(o => o.id === selectedId)) setSelectedId(null);
  }, [objects, selectedId]);

  // Drive the canvas's highlight helper from React selection state
  useEffect(() => {
    setHighlightRef.current(selectedId);
  }, [selectedId]);

  const handleContextAction = (actionId: string, objectId: string) => {
    if (actionId === 'roll')   rollObjectRef.current(objectId);
    if (actionId === 'delete') deleteObjectRef.current(objectId);
  };

  const handleToggleFreeCamera = (on: boolean) => {
    setIsFreeCamera(on);
    freeCameraRef.current(on);
  };

  const handleUpdateTableProp = (key: keyof TableProps, value: unknown) => {
    setTableProps(p => ({ ...p, [key]: value }));
    updateTablePropRef.current(key, value);
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
        sendToRef={sendToRef}
        getTargetsRef={getTargetsRef}
        onMsgRef={onMsgRef}
        onPeerLeftRef={onPeerLeftRef}
        onPeerJoinedRef={onPeerJoinedRef}
        spawnRef={spawnRef}
        rollRef={rollRef}
        onContextMenuRef={onContextMenuRef}
        rollObjectRef={rollObjectRef}
        deleteObjectRef={deleteObjectRef}
        updatePropRef={updatePropRef}
        updateTablePropRef={updateTablePropRef}
        freeCameraRef={freeCameraRef}
        onObjectsChangeRef={onObjectsChangeRef}
        onSelectRef={onSelectRef}
        setHighlightRef={setHighlightRef}
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
        <EditorPanel
          objects={objects}
          selectedId={selectedId}
          isFreeCamera={isFreeCamera}
          tableProps={tableProps}
          onSelect={setSelectedId}
          onSpawn={(t) => spawnRef.current(t)}
          onRollDice={() => rollRef.current()}
          onUpdateProp={(id, key, value) => updatePropRef.current(id, key, value)}
          onUpdateTableProp={handleUpdateTableProp}
          onToggleFreeCamera={handleToggleFreeCamera}
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
          isHost={isHost}
          onAction={handleContextAction}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
