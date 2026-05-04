import { useEffect, useRef, useState } from 'react';
import { ThreeCanvas, type ReplicationTarget } from '../ThreeCanvas';
import { ConnectionManager } from '../net/ConnectionManager';
import { EditorPanel, type ObjectSummary } from '../components/EditorPanel';
import { ContextMenu } from '../components/ContextMenu';
import { PlayersPanel } from '../components/PlayersPanel';
import { Toolbar } from '../components/Toolbar';
import { HostActionBar } from '../components/HostActionBar';
import { AnchorLayout } from '../components/AnchorLayout';
import { UIPanel } from '../components/UIPanel';
import { TOOL_CATALOGUE } from '../input/tools';
import { type ContextMenuRequest, dispatchMenuAction } from '../input/ContextMenuController';
import { type Entity } from '../entity/Entity';
import { type MenuItem } from '../entity/EntityComponent';
import { type ChannelMessage, type SpawnableType } from '../net/SceneState';
import { type SeatIndex } from '../seats/SeatLayout';
import { DEFAULT_TABLE_PROPS, type TableProps } from '../scene/Table';
import { DEFAULT_SKYDOME_PROPS, type SkydomeProps } from '../scene/Skydome';
import { DEFAULT_KEY_LIGHT_PROPS, type KeyLightProps } from '../scene/KeyLight';
import { RoomStateManager } from '../seats/RoomStateManager';
import { RoomStateClient } from '../seats/RoomStateClient';
import type { RoomStateMessage, RoomStateSnapshot } from '../seats/RoomState';
import './Room.css';

type Status = 'connecting' | 'connected' | 'disconnected' | 'room-full';

const SIGNALING_URL = 'ws://localhost:3001';

const STATUS_LABEL: Record<Status, string> = {
  connecting:   'Waiting for peer...',
  connected:    'Connected',
  disconnected: 'Disconnected',
  'room-full':  'Room is full',
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
  const [skydomeProps, setSkydomeProps] = useState<SkydomeProps>(DEFAULT_SKYDOME_PROPS);
  const [keyLightProps, setKeyLightProps] = useState<KeyLightProps>(DEFAULT_KEY_LIGHT_PROPS);
  const [roomSnapshot, setRoomSnapshot] = useState<RoomStateSnapshot | null>(null);
  const [selfPeerId,   setSelfPeerId]   = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState<string>(TOOL_CATALOGUE[0]?.id ?? 'grab');

  const sendRef            = useRef<(msg: ChannelMessage, opts?: { reliable?: boolean }) => void>(noop);
  const sendToRef          = useRef<(peerId: string, msg: ChannelMessage, opts?: { reliable?: boolean }) => void>(noop);
  const getTargetsRef      = useRef<() => ReplicationTarget[]>(() => []);
  const getSelfSeatRef     = useRef<() => SeatIndex | null>(() => null);
  const getSelfPeerIdRef   = useRef<() => string | null>(() => null);
  const getPeerSeatRef     = useRef<(peerId: string) => SeatIndex | null>(() => null);
  const onMsgRef           = useRef<(peerId: string, msg: ChannelMessage) => void>(noop);
  const onPeerLeftRef      = useRef<(peerId: string) => void>(noop);
  const onPeerJoinedRef    = useRef<(peerId: string) => void>(noop);
  const spawnRef           = useRef<(type: SpawnableType) => void>(noop);
  const rollRef            = useRef<() => void>(noop);
  const onContextMenuRef   = useRef<(req: ContextMenuRequest) => void>(noop);
  const deleteObjectRef    = useRef<(id: string) => void>(noop);
  const updatePropRef      = useRef<(id: string, key: string, value: unknown) => void>(noop);
  const updateTablePropRef    = useRef<(key: keyof TableProps, value: unknown) => void>(noop);
  const updateSkydomePropRef  = useRef<(key: keyof SkydomeProps, value: unknown) => void>(noop);
  const updateKeyLightPropRef = useRef<(key: keyof KeyLightProps, value: unknown) => void>(noop);
  const freeCameraRef      = useRef<(on: boolean) => void>(noop);
  const onObjectsChangeRef = useRef<(objs: ObjectSummary[]) => void>(noop);
  const onSelectRef        = useRef<(id: string | null) => void>(noop);
  const setHighlightRef    = useRef<(id: string | null) => void>(noop);
  const getEntityRef       = useRef<(id: string) => Entity | undefined>(() => undefined);
  const setActiveToolRef   = useRef<(toolId: string) => boolean>(() => false);
  const getActiveToolRef   = useRef<() => string>(() => activeToolId);
  const claimSeatRef       = useRef<(seatIndex: SeatIndex) => void>(noop);
  const kickPeerRef        = useRef<(peerId: string) => void>(noop);
  const banPeerRef         = useRef<(peerId: string) => void>(noop);

  // Set every render — fine, it's just a ref assignment.
  onContextMenuRef.current   = (req) => setContextMenu(req);
  onObjectsChangeRef.current = (objs) => setObjects(objs);
  onSelectRef.current        = (id) => setSelectedId(id);
  getActiveToolRef.current   = () => activeToolId;

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
        if (m.type === 'seat-claim-request') {
          if (manager) {
            manager.claimSeat(peerId, m.seatIndex);
            // No reply: the resulting patch (if any) broadcasts to all peers via
            // the manager's onChange listener.
          }
          return;
        }
        if (m.type === 'kicked') {
          setStatus('disconnected');
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
        if (manager.isBanned(peerId)) {
          mgr.sendTo(peerId, { type: 'kicked', reason: 'ban' } satisfies RoomStateMessage);
          mgr.kickPeer(peerId);
          return;
        }
        manager.assignOnJoin(peerId);
        const snapshotMsg: RoomStateMessage = { type: 'room-state', snapshot: manager.snapshot() };
        mgr.sendTo(peerId, snapshotMsg);
        onPeerJoinedRef.current(peerId);
      },
      (peerId) => {
        setSelfPeerId(peerId);
        if (isHost) {
          manager = new RoomStateManager(peerId);
          manager.onChange((change) => {
            const patchMsg: RoomStateMessage = { type: 'room-state-patch', patch: change.patch };
            mgr.send(patchMsg);
            setRoomSnapshot(change.snapshot);
          });
          setRoomSnapshot(manager.snapshot());
          console.log('[RoomState] my seat:', manager.getSeat(peerId));
        } else {
          client = new RoomStateClient(peerId);
          client.onChange(snap => setRoomSnapshot(snap));
        }
      },
    );
    sendRef.current     = (msg, opts)         => mgr.send(msg, opts);
    sendToRef.current   = (peerId, msg, opts) => mgr.sendTo(peerId, msg, opts);
    getTargetsRef.current = () => {
      if (!manager) return [];
      return mgr.getPeerIds().map(peerId => ({
        peerId,
        peerSeat: manager!.getSeat(peerId),
        isHost:   manager!.isHost(peerId),
      }));
    };
    getSelfSeatRef.current = () => {
      if (manager) return manager.getSeat(mgr.getPeerId() ?? '');
      return client?.getMySeat() ?? null;
    };
    getSelfPeerIdRef.current = () => mgr.getPeerId();
    getPeerSeatRef.current = (peerId) => manager?.getSeat(peerId) ?? null;

    claimSeatRef.current = (seatIndex) => {
      if (manager) {
        const self = mgr.getPeerId();
        if (self) manager.claimSeat(self, seatIndex);
        return;
      }
      mgr.send({ type: 'seat-claim-request', seatIndex } satisfies RoomStateMessage);
    };

    kickPeerRef.current = (peerId) => {
      if (!manager) return;
      mgr.sendTo(peerId, { type: 'kicked', reason: 'kick' } satisfies RoomStateMessage);
      manager.removePeer(peerId);
      mgr.kickPeer(peerId);
    };

    banPeerRef.current = (peerId) => {
      if (!manager) return;
      mgr.sendTo(peerId, { type: 'kicked', reason: 'ban' } satisfies RoomStateMessage);
      manager.banPeer(peerId);
      mgr.kickPeer(peerId);
    };

    if (isHost) mgr.hostRoom(SIGNALING_URL, roomId);
    else        mgr.joinRoom(SIGNALING_URL, roomId);

    return () => {
      mgr.dispose();
      sendRef.current          = noop;
      sendToRef.current        = noop;
      getTargetsRef.current    = () => [];
      getSelfSeatRef.current   = () => null;
      getSelfPeerIdRef.current = () => null;
      getPeerSeatRef.current   = () => null;
      claimSeatRef.current     = noop;
      kickPeerRef.current      = noop;
      banPeerRef.current       = noop;
      setRoomSnapshot(null);
      setSelfPeerId(null);
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

  const handleContextAction = (
    item: MenuItem & { kind: 'action' | 'colorpicker' },
    args: object | undefined,
  ) => {
    if (!contextMenu) return;
    dispatchMenuAction(item, args, contextMenu.entityId, {
      isHost,
      entity:   getEntityRef.current(contextMenu.entityId),
      send:     (msg) => sendRef.current(msg),
      hostLocal: {
        delete: (id) => deleteObjectRef.current(id),
      },
      selfSeat: getSelfSeatRef.current(),
    });
  };

  const handleToggleFreeCamera = (on: boolean) => {
    setIsFreeCamera(on);
    freeCameraRef.current(on);
  };

  const handleSelectTool = (toolId: string) => {
    if (toolId === activeToolId) return;
    if (setActiveToolRef.current(toolId)) setActiveToolId(toolId);
  };

  const handleUpdateTableProp = (key: keyof TableProps, value: unknown) => {
    setTableProps(p => ({ ...p, [key]: value }));
    updateTablePropRef.current(key, value);
  };

  const handleUpdateSkydomeProp = (key: keyof SkydomeProps, value: unknown) => {
    setSkydomeProps(p => ({ ...p, [key]: value as SkydomeProps[typeof key] }));
    updateSkydomePropRef.current(key, value);
  };

  const handleUpdateKeyLightProp = (key: keyof KeyLightProps, value: unknown) => {
    setKeyLightProps(p => ({ ...p, [key]: value as KeyLightProps[typeof key] }));
    updateKeyLightPropRef.current(key, value);
  };

  const shareUrl = (() => {
    const u = new URL(window.location.href);
    u.searchParams.delete('host');
    return u.toString();
  })();

  return (
    <div className="room">
      <ThreeCanvas
        isHost={isHost}
        sendRef={sendRef}
        sendToRef={sendToRef}
        getTargetsRef={getTargetsRef}
        getSelfSeatRef={getSelfSeatRef}
        getSelfPeerIdRef={getSelfPeerIdRef}
        getPeerSeatRef={getPeerSeatRef}
        onMsgRef={onMsgRef}
        onPeerLeftRef={onPeerLeftRef}
        onPeerJoinedRef={onPeerJoinedRef}
        spawnRef={spawnRef}
        rollRef={rollRef}
        onContextMenuRef={onContextMenuRef}
        deleteObjectRef={deleteObjectRef}
        updatePropRef={updatePropRef}
        updateTablePropRef={updateTablePropRef}
        updateSkydomePropRef={updateSkydomePropRef}
        updateKeyLightPropRef={updateKeyLightPropRef}
        freeCameraRef={freeCameraRef}
        onObjectsChangeRef={onObjectsChangeRef}
        onSelectRef={onSelectRef}
        setHighlightRef={setHighlightRef}
        getEntityRef={getEntityRef}
        setActiveToolRef={setActiveToolRef}
        getActiveToolRef={getActiveToolRef}
      />

      <AnchorLayout>
        <UIPanel anchor="top-center" order={0}>
          <div className={`room__status room__status--${status}`}>
            {STATUS_LABEL[status]}
          </div>
        </UIPanel>

        {isHost && (
          <UIPanel anchor="top-center" order={10}>
            <HostActionBar onSpawn={(t) => spawnRef.current(t)} />
          </UIPanel>
        )}

        {isHost && (
          <UIPanel anchor="top-left" order={10}>
            <EditorPanel
              objects={objects}
              selectedId={selectedId}
              isFreeCamera={isFreeCamera}
              tableProps={tableProps}
              skydomeProps={skydomeProps}
              keyLightProps={keyLightProps}
              onSelect={setSelectedId}
              onRollDice={() => rollRef.current()}
              onUpdateProp={(id, key, value) => updatePropRef.current(id, key, value)}
              onUpdateTableProp={handleUpdateTableProp}
              onUpdateSkydomeProp={handleUpdateSkydomeProp}
              onUpdateKeyLightProp={handleUpdateKeyLightProp}
              onToggleFreeCamera={handleToggleFreeCamera}
            />
          </UIPanel>
        )}

        <UIPanel anchor="top-right" order={10}>
          <PlayersPanel
            snapshot={roomSnapshot}
            selfPeerId={selfPeerId}
            isHost={isHost}
            onClaimSeat={(idx) => claimSeatRef.current(idx)}
            onKick={(id) => kickPeerRef.current(id)}
            onBan={(id) => banPeerRef.current(id)}
          />
        </UIPanel>

        <UIPanel anchor="bottom-left" order={10}>
          <Toolbar activeToolId={activeToolId} onSelectTool={handleSelectTool} />
        </UIPanel>

        {isHost && status === 'connecting' && (
          <UIPanel anchor="bottom-center" order={10}>
            <div className="room__share">
              <div className="room__share-label">Share this link with your guest:</div>
              <div className="room__share-url">{shareUrl}</div>
            </div>
          </UIPanel>
        )}
      </AnchorLayout>

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
