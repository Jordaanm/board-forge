import { useEffect, useRef, useState } from 'react';
import { ThreeCanvas, type ReplicationTarget, type HandView } from '../ThreeCanvas';
import { ConnectionManager } from '../net/ConnectionManager';
import { EditorPanel, type ObjectSummary } from '../components/EditorPanel';
import { ContextMenu } from '../components/ContextMenu';
import { PlayersPanel } from '../components/PlayersPanel';
import { Toolbar } from '../components/Toolbar';
import { HostActionBar } from '../components/HostActionBar';
import { AnchorLayout } from '../components/AnchorLayout';
import { UIPanel } from '../components/UIPanel';
import { HandPanel } from '../components/HandPanel';
import { TOOL_CATALOGUE } from '../input/tools';
import { type ContextMenuRequest, dispatchMenuAction } from '../input/ContextMenuController';
import { type Entity } from '../entity/Entity';
import { type MenuItem } from '../entity/EntityComponent';
import { type ChannelMessage, type SpawnableType } from '../net/SceneState';
import { type SeatIndex } from '../seats/SeatLayout';
import { type InputEventName, type InputEventPayload } from '../input/inputEvents';
import { RoomStateManager } from '../seats/RoomStateManager';
import { RoomStateClient } from '../seats/RoomStateClient';
import type { RoomStateMessage, RoomStateSnapshot } from '../seats/RoomState';
import { type SceneHistoryService, type LastLoaded } from '../entity/SceneHistoryService';
import { type RunResult, type ScriptState } from '../scripting/ScriptHost';
import { type ScriptErrorLog } from '../scripting/ScriptErrorLog';
import { ManifestStore } from '../assets/ManifestStore';
import { assetService } from '../assets/AssetService';
import { BASE_MANIFEST, PRIMITIVE_MANIFEST } from '../assets/baseManifest';
import { AssetLoadingIndicator } from '../components/AssetLoadingIndicator';
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
  const [roomSnapshot, setRoomSnapshot] = useState<RoomStateSnapshot | null>(null);
  const [selfPeerId,   setSelfPeerId]   = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState<string>(TOOL_CATALOGUE[0]?.id ?? 'grab');
  const [showAllZones, setShowAllZones] = useState(false);
  const [handView, setHandView]         = useState<HandView | null>(null);
  const [lastLoaded, setLastLoaded]     = useState<LastLoaded | null>(null);
  const [historyService, setHistoryService] = useState<SceneHistoryService | null>(null);
  const [scriptSource, setScriptSource]     = useState<string>('');
  const [scriptErrorLog, setScriptErrorLog] = useState<ScriptErrorLog | null>(null);
  const [manifestStore, setManifestStore]   = useState<ManifestStore | null>(null);

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
  const drawFromDeckRef    = useRef<(deckId: string, count: number, callerSeat: SeatIndex | null) => void>(noop);
  const shuffleDeckRef     = useRef<(deckId: string) => void>(noop);
  const dealFromDeckRef    = useRef<(deckId: string, count: number, callerSeat: SeatIndex | null) => void>(noop);
  const updatePropRef      = useRef<(id: string, key: string, value: unknown) => void>(noop);
  const freeCameraRef      = useRef<(on: boolean) => void>(noop);
  const onObjectsChangeRef = useRef<(objs: ObjectSummary[]) => void>(noop);
  const onSelectRef        = useRef<(id: string | null) => void>(noop);
  const setHighlightRef    = useRef<(id: string | null) => void>(noop);
  const getEntityRef       = useRef<(id: string) => Entity | undefined>(() => undefined);
  const setActiveToolRef   = useRef<(toolId: string) => boolean>(() => false);
  const getActiveToolRef   = useRef<() => string>(() => activeToolId);
  const setShowAllZonesRef = useRef<(on: boolean) => void>(noop);
  const setHandViewRef     = useRef<(view: HandView | null) => void>(noop);
  const requestHandTileMenuRef = useRef<(entityId: string, x: number, y: number) => void>(noop);
  const playCardToTableRef = useRef<(entityId: string, x: number, y: number) => void>(noop);
  const reorderHandRef     = useRef<(handEntityId: string, newOrder: string[]) => void>(noop);
  const fireTileInputEventRef = useRef<(tileId: string, eventName: InputEventName, payload: InputEventPayload) => void>(noop);
  const claimSeatRef       = useRef<(seatIndex: SeatIndex) => void>(noop);
  const kickPeerRef        = useRef<(peerId: string) => void>(noop);
  const banPeerRef         = useRef<(peerId: string) => void>(noop);
  const saveSceneRef       = useRef<() => void>(noop);
  const replaceSceneRef    = useRef<(snaps: unknown[]) => void>(noop);
  const sceneHistoryRef    = useRef<SceneHistoryService | null>(null);
  const onLastLoadedChangeRef = useRef<(loaded: LastLoaded | null) => void>(noop);
  const onHistoryServiceChangeRef = useRef<(svc: SceneHistoryService | null) => void>(noop);
  const runScriptRef       = useRef<(source: string) => Promise<RunResult>>(() => Promise.resolve({ ok: false, error: 'Canvas not ready.' }));
  const saveScriptSourceRef    = useRef<(source: string) => void>(noop);
  const getSavedScriptSourceRef = useRef<() => string>(() => '');
  const loadScriptStateRef     = useRef<(state: ScriptState) => void>(noop);
  const onErrorLogChangeRef = useRef<(log: ScriptErrorLog | null) => void>(noop);
  const manifestStoreRef    = useRef<ManifestStore | null>(null);
  const getManifestRef      = useRef<() => import('../assets/Manifest').AssetEntry[]>(() => []);
  onErrorLogChangeRef.current = (log) => setScriptErrorLog(log);
  getManifestRef.current      = () => manifestStoreRef.current?.getDraft().toArray() ?? [];
  onLastLoadedChangeRef.current     = (loaded) => setLastLoaded(loaded);
  onHistoryServiceChangeRef.current = (svc)    => setHistoryService(svc);

  // Set every render — fine, it's just a ref assignment.
  onContextMenuRef.current   = (req) => setContextMenu(req);
  onObjectsChangeRef.current = (objs) => setObjects(objs);
  onSelectRef.current        = (id) => setSelectedId(id);
  getActiveToolRef.current   = () => activeToolId;
  setHandViewRef.current     = (view) => setHandView(view);

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
        if (m.type === 'manifest-publish') {
          manifestStoreRef.current?.applyPublishedSnapshot(m.snapshot);
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
        const manifestSnap = manifestStoreRef.current?.getPublished().toArray() ?? [];
        if (manifestSnap.length > 0) {
          mgr.sendTo(peerId, { type: 'manifest-publish', snapshot: manifestSnap });
        }
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

  // Manifest store — both roles. Host edits draft locally and pushes to peers
  // via the manager modal; guests receive published snapshots through
  // `applyPublishedSnapshot`. AssetService follows the draft so the host
  // sees locally staged additions immediately and guests resolve the latest
  // pushed catalog (where draft == published).
  useEffect(() => {
    const store = new ManifestStore();
    manifestStoreRef.current = store;
    setManifestStore(store);
    const refresh = () => {
      assetService.setManifests([BASE_MANIFEST, PRIMITIVE_MANIFEST, store.getDraft()]);
      // Issue #7 — kick off `preload: true` fetches whenever the catalog
      // changes (initial mount, host edits, guest applies a published
      // snapshot). The promise is intentionally fire-and-forget; gameplay
      // does not await it and the HUD indicator reflects progress.
      void assetService.preload([BASE_MANIFEST, PRIMITIVE_MANIFEST, store.getDraft()]);
    };
    refresh();
    const unsub = store.subscribe(refresh);
    return () => {
      unsub();
      manifestStoreRef.current = null;
      setManifestStore(null);
      assetService.setManifests([BASE_MANIFEST, PRIMITIVE_MANIFEST]);
    };
  }, []);

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
        delete:        (id) => deleteObjectRef.current(id),
        drawFromDeck:  (deckId, count, seat) => drawFromDeckRef.current(deckId, count, seat),
        shuffleDeck:   (deckId) => shuffleDeckRef.current(deckId),
        dealFromDeck:  (deckId, count, seat) => dealFromDeckRef.current(deckId, count, seat),
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

  const handleToggleShowAllZones = (on: boolean) => {
    setShowAllZones(on);
    setShowAllZonesRef.current(on);
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
        drawFromDeckRef={drawFromDeckRef}
        shuffleDeckRef={shuffleDeckRef}
        dealFromDeckRef={dealFromDeckRef}
        updatePropRef={updatePropRef}
        freeCameraRef={freeCameraRef}
        onObjectsChangeRef={onObjectsChangeRef}
        onSelectRef={onSelectRef}
        setHighlightRef={setHighlightRef}
        getEntityRef={getEntityRef}
        setActiveToolRef={setActiveToolRef}
        getActiveToolRef={getActiveToolRef}
        setShowAllZonesRef={setShowAllZonesRef}
        setHandViewRef={setHandViewRef}
        requestHandTileMenuRef={requestHandTileMenuRef}
        playCardToTableRef={playCardToTableRef}
        reorderHandRef={reorderHandRef}
        fireTileInputEventRef={fireTileInputEventRef}
        saveSceneRef={saveSceneRef}
        replaceSceneRef={replaceSceneRef}
        sceneHistoryRef={sceneHistoryRef}
        onLastLoadedChangeRef={onLastLoadedChangeRef}
        onHistoryServiceChangeRef={onHistoryServiceChangeRef}
        runScriptRef={runScriptRef}
        saveScriptSourceRef={saveScriptSourceRef}
        getSavedScriptSourceRef={getSavedScriptSourceRef}
        loadScriptStateRef={loadScriptStateRef}
        onErrorLogChangeRef={onErrorLogChangeRef}
        getManifestRef={getManifestRef}
      />

      <AnchorLayout>
        <UIPanel anchor="top-center" order={0}>
          <div className={`room__status room__status--${status}`}>
            {STATUS_LABEL[status]}
          </div>
        </UIPanel>

        {isHost && (
          <UIPanel anchor="top-center" order={10}>
            <HostActionBar
              onSpawn={(t) => spawnRef.current(t)}
              showAllZones={showAllZones}
              onToggleShowAllZones={handleToggleShowAllZones}
              onSave={() => saveSceneRef.current()}
              onLoad={(envelope, filename) => {
                sceneHistoryRef.current?.setLastLoaded({
                  snapshot: envelope.scene,
                  filename,
                  savedAt:  envelope.savedAt,
                });
                replaceSceneRef.current(envelope.scene);
                loadScriptStateRef.current(envelope.script);
                setScriptSource(envelope.script.source);
                manifestStoreRef.current?.loadFromSave(envelope.manifest);
              }}
              onRevert={() => sceneHistoryRef.current?.revert()}
              lastLoaded={lastLoaded}
              currentEntityCount={objects.length}
              historyService={historyService}
              scriptSource={scriptSource}
              onScriptChange={setScriptSource}
              onScriptSave={() => saveScriptSourceRef.current(scriptSource)}
              onScriptRun={(src) => runScriptRef.current(src)}
              getSavedScriptSource={() => getSavedScriptSourceRef.current()}
              scriptErrorLog={scriptErrorLog}
              manifestStore={manifestStore}
              onPushManifest={() => {
                const store = manifestStoreRef.current;
                if (!store) return;
                const snapshot = store.push();
                sendRef.current({ type: 'manifest-publish', snapshot });
              }}
            />
          </UIPanel>
        )}

        {isHost && (
          <UIPanel anchor="top-left" order={10}>
            <EditorPanel
              objects={objects}
              selectedId={selectedId}
              isFreeCamera={isFreeCamera}
              manifestStore={manifestStore}
              onSelect={setSelectedId}
              onRollDice={() => rollRef.current()}
              onUpdateProp={(id, key, value) => updatePropRef.current(id, key, value)}
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

        <UIPanel anchor="bottom-right" order={20}>
          <AssetLoadingIndicator />
        </UIPanel>

        {isHost && status === 'connecting' && (
          <UIPanel anchor="bottom-center" order={10}>
            <div className="room__share">
              <div className="room__share-label">Share this link with your guest:</div>
              <div className="room__share-url">{shareUrl}</div>
            </div>
          </UIPanel>
        )}

        {handView && (
          <UIPanel anchor="bottom-center" order={20}>
            <HandPanel
              cards={handView.cards}
              selectedId={selectedId}
              onSelectTile={(id) => setSelectedId(id)}
              onTileContextMenu={(id, x, y) => requestHandTileMenuRef.current(id, x, y)}
              onPlayCardToTable={(id, x, y) => playCardToTableRef.current(id, x, y)}
              onReorderHand={(newOrder) => reorderHandRef.current(handView.handEntityId, newOrder)}
              handEntityId={handView.handEntityId}
              onTileInputEvent={(id, name, payload) => fireTileInputEventRef.current(id, name, payload)}
              selfSeat={getSelfSeatRef.current()}
            />
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
