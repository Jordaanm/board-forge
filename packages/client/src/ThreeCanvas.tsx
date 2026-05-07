import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { createTable, applyTableProp, DEFAULT_TABLE_PROPS, type TableProps, type TableShape } from './scene/Table';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { createSkydome, applySkydomeProp, type SkydomeProps } from './scene/Skydome';
import { createKeyLight, applyKeyLightProp, type KeyLightProps } from './scene/KeyLight';
import { createWorld } from './entity/world';
import { type World, type WorldInboundMessage } from './entity/world';
import { RtcTransport } from './entity/world';
import { type Entity } from './entity/Entity';
import { TransformComponent } from './entity/components/TransformComponent';
import { MeshComponent } from './entity/components/MeshComponent';
import { ValueComponent } from './entity/components/ValueComponent';
import { DiceComponent } from './entity/components/DiceComponent';
import { ZoneComponent } from './entity/components/ZoneComponent';
import { HandComponent } from './entity/components/HandComponent';
import { FlatViewComponent } from './entity/components/FlatViewComponent';
import { CardComponent } from './entity/components/CardComponent';
import { aggregateContextMenu } from './entity/contextMenu';
import { encodeSaveFile, downloadSaveFile } from './entity/SaveFile';
import { captureCanvasThumbnail } from './entity/thumbnail';
import { type SceneHistoryService, type LastLoaded } from './entity/SceneHistoryService';
import { type RunResult, type ScriptState } from './scripting/ScriptHost';
import { type ScriptErrorLog } from './scripting/ScriptErrorLog';
import { type CardTile } from './components/HandPanel';
import { type AssetEntry } from './assets/Manifest';
import { DEFAULT_PRIVATE_FIELDS } from './seats/PrivacyScrubber';
import { MoveGizmo } from './scene/MoveGizmo';
import { CameraController } from './camera/CameraController';
import { ToolDispatcher, TOOL_CATALOGUE, type Tool } from './input/tools';
import { GrabTool } from './input/tools/GrabTool';
import { ContextMenuController, type ContextMenuRequest } from './input/ContextMenuController';
import { type ChannelMessage, type SpawnableType } from './net/SceneState';
import { type SeatIndex } from './seats/SeatLayout';
import { CursorTracker } from './cursor/CursorTracker';
import { CursorOverlay } from './cursor/CursorOverlay';
import { PingOverlay } from './cursor/PingOverlay';
import { TABLE_SURFACE_Y } from './scene/Table';
import { type ObjectSummary } from './components/EditorPanel';

export interface ReplicationTarget {
  peerId:   string;
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

interface Props {
  isHost:              boolean;
  sendRef:             MutableRefObject<(msg: ChannelMessage, opts?: { reliable?: boolean }) => void>;
  sendToRef:           MutableRefObject<(peerId: string, msg: ChannelMessage, opts?: { reliable?: boolean }) => void>;
  getTargetsRef:       MutableRefObject<() => ReplicationTarget[]>;
  getSelfSeatRef:      MutableRefObject<() => SeatIndex | null>;
  getSelfPeerIdRef:    MutableRefObject<() => string | null>;
  getPeerSeatRef:      MutableRefObject<(peerId: string) => SeatIndex | null>;
  onMsgRef:            MutableRefObject<(peerId: string, msg: ChannelMessage) => void>;
  onPeerLeftRef:       MutableRefObject<(peerId: string) => void>;
  onPeerJoinedRef:     MutableRefObject<(peerId: string) => void>;
  spawnRef:            MutableRefObject<(type: SpawnableType) => void>;
  rollRef:             MutableRefObject<() => void>;
  onContextMenuRef:    MutableRefObject<(req: ContextMenuRequest) => void>;
  deleteObjectRef:     MutableRefObject<(id: string) => void>;
  drawFromDeckRef:     MutableRefObject<(deckId: string, count: number, callerSeat: SeatIndex | null) => void>;
  shuffleDeckRef:      MutableRefObject<(deckId: string) => void>;
  dealFromDeckRef:     MutableRefObject<(deckId: string, count: number, callerSeat: SeatIndex | null) => void>;
  updatePropRef:       MutableRefObject<(id: string, key: string, value: unknown) => void>;
  updateTablePropRef:    MutableRefObject<(key: keyof TableProps, value: unknown) => void>;
  updateSkydomePropRef:  MutableRefObject<(key: keyof SkydomeProps, value: unknown) => void>;
  updateKeyLightPropRef: MutableRefObject<(key: keyof KeyLightProps, value: unknown) => void>;
  freeCameraRef:       MutableRefObject<(on: boolean) => void>;
  onObjectsChangeRef:  MutableRefObject<(objects: ObjectSummary[]) => void>;
  onSelectRef:         MutableRefObject<(id: string | null) => void>;
  setHighlightRef:     MutableRefObject<(id: string | null) => void>;
  getEntityRef:        MutableRefObject<(id: string) => Entity | undefined>;
  setActiveToolRef:    MutableRefObject<(toolId: string) => boolean>;
  getActiveToolRef:    MutableRefObject<() => string>;
  setShowAllZonesRef:  MutableRefObject<(on: boolean) => void>;
  setHandViewRef:      MutableRefObject<(view: HandView | null) => void>;
  requestHandTileMenuRef: MutableRefObject<(entityId: string, x: number, y: number) => void>;
  playCardToTableRef:  MutableRefObject<(entityId: string, clientX: number, clientY: number) => void>;
  reorderHandRef:      MutableRefObject<(handEntityId: string, newOrder: string[]) => void>;
  saveSceneRef:        MutableRefObject<() => void>;
  replaceSceneRef:     MutableRefObject<(snaps: unknown[]) => void>;
  sceneHistoryRef:     MutableRefObject<SceneHistoryService | null>;
  onLastLoadedChangeRef: MutableRefObject<(loaded: LastLoaded | null) => void>;
  onHistoryServiceChangeRef: MutableRefObject<(svc: SceneHistoryService | null) => void>;
  runScriptRef:        MutableRefObject<(source: string) => Promise<RunResult>>;
  saveScriptSourceRef: MutableRefObject<(source: string) => void>;
  getSavedScriptSourceRef: MutableRefObject<() => string>;
  loadScriptStateRef:  MutableRefObject<(state: ScriptState) => void>;
  onErrorLogChangeRef: MutableRefObject<(log: ScriptErrorLog | null) => void>;
  getManifestRef:      MutableRefObject<() => AssetEntry[]>;
}

export interface HandView {
  handEntityId: string;
  cards:        CardTile[];
}

export function ThreeCanvas({
  isHost, sendRef, sendToRef, getTargetsRef, getSelfSeatRef, getSelfPeerIdRef, getPeerSeatRef,
  onMsgRef, onPeerLeftRef, onPeerJoinedRef,
  spawnRef, rollRef, onContextMenuRef, deleteObjectRef, drawFromDeckRef, shuffleDeckRef, dealFromDeckRef,
  updatePropRef, updateTablePropRef, updateSkydomePropRef, updateKeyLightPropRef,
  freeCameraRef, onObjectsChangeRef,
  onSelectRef, setHighlightRef, getEntityRef, setActiveToolRef, getActiveToolRef,
  setShowAllZonesRef,
  setHandViewRef, requestHandTileMenuRef, playCardToTableRef, reorderHandRef,
  saveSceneRef, replaceSceneRef, sceneHistoryRef, onLastLoadedChangeRef,
  onHistoryServiceChangeRef, runScriptRef, saveScriptSourceRef, getSavedScriptSourceRef, loadScriptStateRef,
  onErrorLogChangeRef, getManifestRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Renderer ─────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / container.clientHeight, 0.1, 1000,
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x3a2e24, 0.55);
    scene.add(hemiLight);

    const keyLight = createKeyLight();
    scene.add(keyLight);

    const skydomeMesh = createSkydome();
    scene.add(skydomeMesh);

    const rimLight = new THREE.DirectionalLight(0x9cc9ff, 0.35);
    rimLight.position.set(-6, 6, -4);
    scene.add(rimLight);

    const tableMesh = createTable();
    scene.add(tableMesh);

    const physicsWorld = isHost ? new PhysicsWorld() : null;

    const camController = new CameraController(camera, renderer.domElement);

    const cursorTracker = new CursorTracker();
    const cursorOverlay = new CursorOverlay(scene);
    let   pingOverlay: PingOverlay | null = null;

    // Local pointer state — raycast onto the table plane and broadcast at
    // ~30Hz so peers see this user's cursor in real time.
    const cursorRay      = new THREE.Raycaster();
    const cursorPtrNDC   = new THREE.Vector2();
    const cursorPlane    = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_SURFACE_Y);
    const cursorHit      = new THREE.Vector3();
    let   cursorPending: { x: number; z: number } | null = null;
    let   cursorLastSent = 0;
    const CURSOR_INTERVAL_MS = 33;

    const onCursorMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      cursorPtrNDC.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      cursorRay.setFromCamera(cursorPtrNDC, camera);
      if (!cursorRay.ray.intersectPlane(cursorPlane, cursorHit)) return;
      cursorPending = { x: cursorHit.x, z: cursorHit.z };
    };
    renderer.domElement.addEventListener('pointermove', onCursorMove);

    freeCameraRef.current = (on) => camController.setRestricted(on);

    // ── World transport ─────────────────────────────────────────────────
    // RtcTransport owns per-peer fan-out and privacy scrubbing internally.
    // Cursor traffic continues to flow outside the World (it isn't a
    // SceneMessage) and is dispatched directly in onMsgRef below.
    let worldRef: World | null = null;
    const transport = new RtcTransport({
      send:       (msg, opts) => sendRef.current(msg, opts),
      sendTo:     (peerId, msg, opts) => sendToRef.current(peerId, msg, opts),
      getTargets: isHost ? () => getTargetsRef.current() : () => [],
      getEntity:  (id) => worldRef?.get(id)?.entity,
      privateFieldRegistry: DEFAULT_PRIVATE_FIELDS,
    });

    const world: World = createWorld({
      role:        isHost ? 'host' : 'guest',
      scene,
      identity: {
        isHost,
        selfSeat:   () => getSelfSeatRef.current(),
        selfPeerId: () => getSelfPeerIdRef.current(),
      },
      transport,
      physics:     physicsWorld ?? undefined,
      getPeerSeat: isHost ? (peerId) => getPeerSeatRef.current(peerId) : undefined,
      captureThumb: isHost
        ? () => {
            // WebGLRenderer defaults to preserveDrawingBuffer:false, so the
            // canvas backbuffer is cleared after each rAF. Re-render before
            // capture so toDataURL reads a populated buffer instead of blank.
            renderer.render(scene, camera);
            return captureCanvasThumbnail(renderer.domElement, { width: 192, height: 108 });
          }
        : undefined,
    });
    worldRef = world;

    pingOverlay = new PingOverlay(scene, world);
    const unsubscribePing = world.onToolBroadcast((msg) => pingOverlay?.ingest(msg));

    // ── Selection highlight ─────────────────────────────────────────────
    // BoxHelper is tool-independent and renders directly from selection state.
    // The MoveGizmo overlay is owned by GrabTool's AxisGizmoAttachment, which
    // attaches/detaches as selection changes while the tool is active.
    let highlightHelper: THREE.BoxHelper | null = null;
    let highlightId:     string | null = null;
    const moveGizmo     = new MoveGizmo();

    const clearHighlightBox = () => {
      if (highlightHelper) {
        scene.remove(highlightHelper);
        highlightHelper.dispose();
        highlightHelper = null;
      }
    };

    const selectCallback = (id: string | null) => onSelectRef.current(id);

    // ── Input wiring ────────────────────────────────────────────────────
    // ToolDispatcher owns pointer events and routes left-click to the active
    // tool. Tool catalogue is a static array (issue 2a — only GrabTool today).
    const tools: Tool[] = TOOL_CATALOGUE.map(f => f.create({
      scene, moveGizmo, onSelect: selectCallback,
    }));
    const grabTool = tools.find(t => t.id === 'grab') as GrabTool;
    const dispatcher = new ToolDispatcher({
      world, scene, camera,
      element: renderer.domElement,
      getSelfSeat: () => getSelfSeatRef.current(),
    });
    dispatcher.setActiveTool(grabTool);

    setActiveToolRef.current = (toolId) => {
      const tool = tools.find(t => t.id === toolId);
      if (!tool) return false;
      return dispatcher.setActiveTool(tool);
    };

    setHighlightRef.current = (id) => {
      if (highlightId === id) return;
      highlightId = id;
      ZoneComponent.selectedEntityId = id;
      clearHighlightBox();
      if (id) {
        const obj = world.get(id)?.get(TransformComponent)?.object3d;
        if (obj) {
          highlightHelper = new THREE.BoxHelper(obj, 0xffd740);
          (highlightHelper.material as THREE.LineBasicMaterial).linewidth = 2;
          scene.add(highlightHelper);
        }
      }
      grabTool.setSelection(id, dispatcher.getContext());
    };

    setShowAllZonesRef.current = (on) => { ZoneComponent.showAllZones = on; };

    // Hand panel "play to table". Raycasts the screen pointer to the table
    // surface and dispatches via the World facade — host runs the tween,
    // guest fires the play-card-to-table RPC. Y is lifted just above the
    // table so the card doesn't z-fight on landing; gravity settles it.
    const playRay   = new THREE.Raycaster();
    const playNDC   = new THREE.Vector2();
    const playHit   = new THREE.Vector3();
    const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_SURFACE_Y);
    playCardToTableRef.current = (entityId, clientX, clientY) => {
      const handle = world.get(entityId);
      if (!handle) return;
      const rect = renderer.domElement.getBoundingClientRect();
      playNDC.set(
         ((clientX - rect.left) / rect.width)  * 2 - 1,
        -((clientY - rect.top)  / rect.height) * 2 + 1,
      );
      playRay.setFromCamera(playNDC, camera);
      if (!playRay.ray.intersectPlane(tablePlane, playHit)) return;
      world.playCardToTable(handle.entity, [playHit.x, playHit.y + 0.05, playHit.z]);
    };

    reorderHandRef.current = (handEntityId, newOrder) => {
      world.reorderHand(handEntityId, newOrder);
    };

    // Compose a ContextMenuRequest for a hand-panel tile right-click. Reuses
    // the same aggregation pipeline as 3D right-clicks so component-contributed
    // items (e.g. CardComponent flip) appear identically.
    requestHandTileMenuRef.current = (entityId, x, y) => {
      const handle = world.get(entityId);
      if (!handle) return;
      const entity = handle.entity;
      const seat = getSelfSeatRef.current();
      const items = aggregateContextMenu(entity, {
        recipientSeat: seat, isHost, entity,
      });
      if (items.length === 0) return;
      onContextMenuRef.current({
        x, y,
        entityId:   entity.id,
        entityName: entity.name,
        entityTags: [...entity.tags],
        items,
      });
    };

    const unsubscribe = world.subscribe(() => {
      if (highlightId && !world.get(highlightId)) {
        highlightId = null;
        clearHighlightBox();
        grabTool.setSelection(null, dispatcher.getContext());
      }
      onObjectsChangeRef.current(world.all().map(h => entityToObjectSummary(h.entity)));
    });

    const contextCtrl = new ContextMenuController(
      renderer.domElement, camera, isHost, world,
      () => getSelfSeatRef.current(),
      (req) => onContextMenuRef.current(req),
    );

    getEntityRef.current = (id) => world.get(id)?.entity;

    let unsubscribeHistory: () => void = () => {};
    if (isHost) {
      sceneHistoryRef.current = world.history;
      onHistoryServiceChangeRef.current(world.history);
      unsubscribeHistory = world.history?.subscribe(() => {
        onLastLoadedChangeRef.current(world.history?.lastLoaded ?? null);
      }) ?? (() => {});

      saveSceneRef.current = () => {
        // Render once before capture so the texture reflects the current
        // animation-loop frame even if Save is clicked between frames.
        renderer.render(scene, camera);
        const thumbnail = captureCanvasThumbnail(renderer.domElement, { width: 480, height: 270 });
        const envelope = encodeSaveFile({
          scene:     world.snapshot(),
          thumbnail,
          script:    world.scripting?.getScriptState(),
          manifest:  getManifestRef.current(),
        });
        downloadSaveFile(envelope);
      };

      replaceSceneRef.current = (snaps) => {
        world.replaceScene(snaps as Parameters<typeof world.replaceScene>[0]);
      };

      runScriptRef.current = (source) => {
        const sh = world.scripting;
        if (!sh) return Promise.resolve({ ok: false, error: 'Scripting unavailable.' });
        return sh.runScript(source);
      };

      onErrorLogChangeRef.current(world.scripting?.errorLog ?? null);

      saveScriptSourceRef.current = (source) => {
        world.scripting?.setSource(source);
      };

      getSavedScriptSourceRef.current = () => {
        return world.scripting?.getScriptState().source ?? '';
      };

      loadScriptStateRef.current = (state) => {
        // `loadScript` overwrites the state slot then runs the script if a
        // source is present, so the auto-Run on save-file load follows the
        // same Run flow as a manual click. Returns a Promise we don't
        // await — the panel doesn't need to block on hook execution.
        const sh = world.scripting;
        if (!sh) return;
        void sh.loadScript(state);
      };

      spawnRef.current        = (type) => { world.spawn(type); };
      deleteObjectRef.current = (id)   => world.despawn(id);
      drawFromDeckRef.current = (deckId, count, seat) => world.drawFromDeck(deckId, count, seat);
      shuffleDeckRef.current  = (deckId) => world.shuffleDeck(deckId);
      dealFromDeckRef.current = (deckId, count, seat) => world.dealFromDeck(deckId, count, seat);
      updatePropRef.current   = (id, key, value) => world.updateProp(id, key, value);

      rollRef.current = () => {
        world.forEach((h) => h.entity.getComponent(DiceComponent)?.roll());
      };

      updateTablePropRef.current = (key, value) => {
        applyTableProp(tableMesh, key, value);
        if (key === 'shape') physicsWorld?.setTableShape(value as TableShape);
        sendRef.current({ type: 'table-update', partial: { [key]: value } as Partial<TableProps> }, { reliable: true });
      };
    }

    updateSkydomePropRef.current  = (key, value) => applySkydomeProp(skydomeMesh, key, value);
    updateKeyLightPropRef.current = (key, value) => applyKeyLightProp(keyLight, key, value);

    // ── Inbound message router ──────────────────────────────────────────
    // Cursor traffic stays here (not a SceneMessage). Everything else is
    // forwarded into worldTransport so World's inbound dispatch handles it.
    onMsgRef.current = (peerId, msg) => {
      if (msg.type === 'table-update') {
        for (const [k, v] of Object.entries(msg.partial)) {
          applyTableProp(tableMesh, k as keyof TableProps, v);
        }
        return;
      }
      if (msg.type === 'cursor-position') {
        if (isHost) {
          // Star topology: host relays each guest's cursor to all other peers.
          cursorTracker.update(msg.peerId, msg.seat, msg.x, msg.z, msg.tool);
          for (const t of getTargetsRef.current()) {
            if (t.peerId === peerId) continue;
            sendToRef.current(t.peerId, msg);
          }
        } else {
          if (msg.peerId === getSelfPeerIdRef.current()) return; // skip echo
          cursorTracker.update(msg.peerId, msg.seat, msg.x, msg.z, msg.tool);
        }
        return;
      }
      transport.deliver(peerId, msg as WorldInboundMessage);
    };

    onPeerLeftRef.current = (peerId) => {
      world.releasePeer(peerId);
      cursorTracker.remove(peerId);
    };

    onPeerJoinedRef.current = (peerId) => {
      transport.firePeerJoin(peerId);
      if (isHost) {
        const props = (tableMesh.userData.tableProps ?? DEFAULT_TABLE_PROPS) as TableProps;
        sendToRef.current(peerId, { type: 'table-update', partial: { ...props } }, { reliable: true });
      }
    };

    // ── Animation loop ────────────────────────────────────────────────────
    let lastTime = performance.now();
    let animId: number;
    let lastHandViewKey = '__init';

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const now = performance.now();
      const dt  = Math.min((now - lastTime) / 1000, 0.05);
      lastTime  = now;

      world.tick(dt);
      dispatcher.update(dt);

      // ── Cursor: throttled send + render sync ───────────────────────────
      const cursorNow = performance.now();
      if (cursorPending && cursorNow - cursorLastSent >= CURSOR_INTERVAL_MS) {
        const selfPeerId = getSelfPeerIdRef.current();
        if (selfPeerId) {
          sendRef.current({
            type:   'cursor-position',
            peerId: selfPeerId,
            seat:   getSelfSeatRef.current(),
            x:      cursorPending.x,
            z:      cursorPending.z,
            tool:   getActiveToolRef.current(),
          });
        }
        cursorLastSent = cursorNow;
        cursorPending  = null;
      }
      cursorOverlay.sync(cursorTracker.all());
      pingOverlay?.update(dt);

      // Drive zone debug-mesh visibility from selection + global toggle.
      world.forEach((h) => h.entity.getComponent(ZoneComponent)?.updateDebugVisibility());

      // Hand panel — re-derive view each frame and push to React only when
      // the view's identity key changes. Cheap (one walk per frame).
      const view = deriveHandView(world, getSelfSeatRef.current());
      const key  = handViewKey(view);
      if (key !== lastHandViewKey) {
        lastHandViewKey = key;
        setHandViewRef.current(view);
      }

      if (highlightHelper) highlightHelper.update();

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointermove', onCursorMove);
      unsubscribePing();
      unsubscribeHistory();
      pingOverlay?.dispose();
      pingOverlay = null;
      cursorOverlay.dispose();
      cursorTracker.clear();
      unsubscribe();
      clearHighlightBox();
      dispatcher.dispose();
      moveGizmo.dispose();
      camController.dispose();
      contextCtrl.dispose();
      world.dispose();
      onMsgRef.current        = () => {};
      onPeerLeftRef.current   = () => {};
      onPeerJoinedRef.current = () => {};
      spawnRef.current        = () => {};
      rollRef.current         = () => {};
      deleteObjectRef.current = () => {};
      saveSceneRef.current    = () => {};
      replaceSceneRef.current = () => {};
      runScriptRef.current    = () => Promise.resolve({ ok: false, error: 'Canvas torn down.' });
      saveScriptSourceRef.current = () => {};
      getSavedScriptSourceRef.current = () => '';
      loadScriptStateRef.current  = () => {};
      onErrorLogChangeRef.current(null);
      sceneHistoryRef.current = null;
      onHistoryServiceChangeRef.current(null);
      drawFromDeckRef.current = () => {};
      shuffleDeckRef.current  = () => {};
      dealFromDeckRef.current = () => {};
      updatePropRef.current      = () => {};
      updateTablePropRef.current    = () => {};
      updateSkydomePropRef.current  = () => {};
      updateKeyLightPropRef.current = () => {};
      freeCameraRef.current      = () => {};
      setHighlightRef.current    = () => {};
      getEntityRef.current       = () => undefined;
      setActiveToolRef.current   = () => false;
      getActiveToolRef.current   = () => 'grab';
      renderer.dispose();
      container.removeChild(renderer.domElement);
      ZoneComponent.selectedEntityId = null;
      ZoneComponent.showAllZones     = false;
    };
  }, [
    isHost, sendRef, sendToRef, getTargetsRef, getSelfSeatRef, getSelfPeerIdRef, getPeerSeatRef,
    onMsgRef, onPeerLeftRef, onPeerJoinedRef,
    spawnRef, rollRef, onContextMenuRef, deleteObjectRef, drawFromDeckRef, shuffleDeckRef, dealFromDeckRef,
    updatePropRef, updateTablePropRef, updateSkydomePropRef, updateKeyLightPropRef,
    freeCameraRef, onObjectsChangeRef,
    onSelectRef, setHighlightRef, getEntityRef, setActiveToolRef, getActiveToolRef,
    setShowAllZonesRef, setHandViewRef, requestHandTileMenuRef, playCardToTableRef,
    reorderHandRef, saveSceneRef, replaceSceneRef, sceneHistoryRef, onLastLoadedChangeRef,
    onHistoryServiceChangeRef, runScriptRef, saveScriptSourceRef, getSavedScriptSourceRef, loadScriptStateRef,
    onErrorLogChangeRef,
  ]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// Resolves the viewer's main hand entity and its current contents into a
// HandView for the bottom-center hand panel. Returns null when the viewer has
// no main hand (unseated, or seated with no isMainHand=true hand).
function deriveHandView(world: World, selfSeat: SeatIndex | null): HandView | null {
  if (selfSeat === null) return null;
  let mainHand: Entity | null = null;
  world.forEach((h) => {
    if (mainHand) return;
    const e = h.entity;
    if (e.owner !== selfSeat) return;
    const hand = e.getComponent(HandComponent);
    if (hand?.state.isMainHand) mainHand = e;
  });
  if (!mainHand) return null;
  const zone = (mainHand as Entity).getComponent(ZoneComponent);
  if (!zone) return null;

  const cards: CardTile[] = [];
  for (const id of zone.state.containedIds) {
    const cardEntity = world.get(id)?.entity;
    if (!cardEntity) continue;
    const flat = cardEntity.getComponent(FlatViewComponent);
    cards.push({
      id,
      name:       cardEntity.name,
      textureRef: flat?.state.textureRef ?? '',
    });
  }
  return { handEntityId: (mainHand as Entity).id, cards };
}

function handViewKey(view: HandView | null): string {
  if (!view) return '';
  return view.handEntityId + '|' + view.cards.map(c => c.id + ':' + c.textureRef).join(',');
}

// Editor-panel view of an entity. Mirrors SceneSystemV2.derivePropsView until
// issue #4 migrates EditorPanel to read components directly.
function entityToObjectSummary(entity: Entity): ObjectSummary {
  const mesh  = entity.getComponent(MeshComponent);
  const value = entity.getComponent(ValueComponent);
  const zone  = entity.getComponent(ZoneComponent);
  const card  = entity.getComponent(CardComponent);
  const props: Record<string, unknown> = { name: entity.name };
  if (entity.type === 'board' && mesh) {
    const sz = mesh.state.size as [number, number, number];
    props.width      = sz[0];
    props.depth      = sz[2];
    props.textureUrl = mesh.state.textureRefs?.default ?? '';
  } else if (entity.type === 'token' && mesh) {
    props.color = mesh.state.tint;
  } else if (entity.type === 'die' && value) {
    props.value = value.state.value;
  } else if (entity.type === 'card' && card) {
    props.face = card.state.face;
    props.back = card.state.back;
  }
  if (zone) {
    const [hx, hy, hz] = zone.state.halfExtents;
    props.halfExtentsX = hx;
    props.halfExtentsY = hy;
    props.halfExtentsZ = hz;
    props.isVisible    = zone.state.isVisible;
  }
  const hand = entity.getComponent(HandComponent);
  if (hand) {
    props.isMainHand = hand.state.isMainHand;
    props.isPrivate  = hand.state.isPrivate;
    props.owner      = entity.owner ?? -1;
  }
  return {
    id:         entity.id,
    objectType: entity.type as SpawnableType,
    tags:       [...entity.tags],
    props,
    parentId:   entity.parentId,
  };
}
