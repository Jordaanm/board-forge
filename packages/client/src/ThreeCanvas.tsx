import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { createTable, applyTableProp, type TableProps } from './scene/Table';
import { getDieFace } from './scene/dieFace';
import { SceneSystemV2 } from './entity/SceneSystemV2';
import { HostReplicatorV2 } from './entity/HostReplicatorV2';
import { applySceneMessage } from './entity/GuestReceiver';
import { EntityComponent } from './entity/EntityComponent';
import { Scene, entityToSerialized } from './entity/Scene';
import { HoldService } from './entity/HoldService';
import { HostInputDispatcher } from './entity/HostInputDispatcher';
import { MoveGizmo } from './scene/MoveGizmo';
import { CameraController } from './camera/CameraController';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { DragController } from './input/DragController';
import { GuestDragController } from './input/GuestDragController';
import { GuestInputHandler } from './input/GuestInputHandler';
import { ContextMenuController, type ContextMenuRequest } from './input/ContextMenuController';
import { type ChannelMessage, type SpawnableType } from './net/SceneState';
import { type SceneMessage } from './entity/wire';
import { type SeatIndex } from './seats/SeatLayout';
import { EMPTY_PRIVATE_FIELD_REGISTRY, scrubSceneMessage } from './seats/PrivacyScrubber';
import { CursorTracker } from './cursor/CursorTracker';
import { CursorOverlay } from './cursor/CursorOverlay';
import { TABLE_SURFACE_Y } from './scene/Table';
import { type ObjectSummary } from './components/EditorPanel';

export interface ReplicationTarget {
  peerId:   string;
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

interface Props {
  isHost:              boolean;
  sendRef:             MutableRefObject<(msg: ChannelMessage) => void>;
  sendToRef:           MutableRefObject<(peerId: string, msg: ChannelMessage) => void>;
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
  rollObjectRef:       MutableRefObject<(id: string) => void>;
  deleteObjectRef:     MutableRefObject<(id: string) => void>;
  updatePropRef:       MutableRefObject<(id: string, key: string, value: unknown) => void>;
  updateTablePropRef:  MutableRefObject<(key: keyof TableProps, value: unknown) => void>;
  freeCameraRef:       MutableRefObject<(on: boolean) => void>;
  onObjectsChangeRef:  MutableRefObject<(objects: ObjectSummary[]) => void>;
  onSelectRef:         MutableRefObject<(id: string | null) => void>;
  setHighlightRef:     MutableRefObject<(id: string | null) => void>;
}

export function ThreeCanvas({
  isHost, sendRef, sendToRef, getTargetsRef, getSelfSeatRef, getSelfPeerIdRef, getPeerSeatRef,
  onMsgRef, onPeerLeftRef, onPeerJoinedRef,
  spawnRef, rollRef, onContextMenuRef, rollObjectRef, deleteObjectRef,
  updatePropRef, updateTablePropRef, freeCameraRef, onObjectsChangeRef,
  onSelectRef, setHighlightRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef   = useRef<HTMLDivElement>(null);

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

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.1);
    keyLight.position.set(6, 14, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near   =  0.5;
    keyLight.shadow.camera.far    = 40;
    keyLight.shadow.camera.left   = -10;
    keyLight.shadow.camera.right  =  10;
    keyLight.shadow.camera.top    =  8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias       = -0.0005;
    keyLight.shadow.normalBias =  0.02;
    keyLight.shadow.radius     =  4;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x9cc9ff, 0.35);
    rimLight.position.set(-6, 6, -4);
    scene.add(rimLight);

    const tableMesh = createTable();
    scene.add(tableMesh);

    const camController = new CameraController(camera, renderer.domElement);
    const graph = new SceneSystemV2();

    const cursorTracker = new CursorTracker();
    const cursorOverlay = new CursorOverlay(scene);

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

    // ── Selection highlight ─────────────────────────────────────────────
    let highlightHelper: THREE.BoxHelper | null = null;
    let highlightId:     string | null = null;
    const moveGizmo = new MoveGizmo();

    const clearHighlight = () => {
      if (highlightHelper) {
        scene.remove(highlightHelper);
        highlightHelper.dispose();
        highlightHelper = null;
      }
      if (moveGizmo.group.parent) scene.remove(moveGizmo.group);
      moveGizmo.detach();
    };

    setHighlightRef.current = (id) => {
      if (highlightId === id) return;
      highlightId = id;
      clearHighlight();
      if (!id) return;
      const entry = graph.getEntry(id);
      if (!entry) return;
      highlightHelper = new THREE.BoxHelper(entry.mesh, 0xffd740);
      (highlightHelper.material as THREE.LineBasicMaterial).linewidth = 2;
      scene.add(highlightHelper);
      moveGizmo.attach(entry.mesh);
      scene.add(moveGizmo.group);
    };

    const selectCallback = (id: string | null) => onSelectRef.current(id);

    const unsubscribe = graph.subscribe(() => {
      if (highlightId && !graph.getEntry(highlightId)) {
        highlightId = null;
        clearHighlight();
      }
      onObjectsChangeRef.current(graph.getAll().map(e => ({
        id: e.id, objectType: e.objectType, props: { ...e.props },
      })));
    });

    // ── Host ─────────────────────────────────────────────────────────────
    let physics:     PhysicsWorld        | null = null;
    let dragCtrl:    DragController      | null = null;
    let guestInput:  GuestInputHandler   | null = null;
    let hostRepl:    HostReplicatorV2    | null = null;
    let holdSvc:     HoldService         | null = null;
    let hostInput:   HostInputDispatcher | null = null;
    let contextCtrl: ContextMenuController | null = null;
    let guestDrag:   GuestDragController | null = null;

    const broadcast = (msgs: SceneMessage[]) => {
      if (msgs.length === 0) return;
      const targets = getTargetsRef.current();
      for (const t of targets) {
        const ctx = { peerSeat: t.peerSeat, isHost: t.isHost };
        for (const m of msgs) {
          const scrubbed = scrubSceneMessage(ctx, m, EMPTY_PRIVATE_FIELD_REGISTRY);
          sendToRef.current(t.peerId, scrubbed);
        }
      }
    };

    if (isHost) {
      physics    = new PhysicsWorld();
      hostRepl   = new HostReplicatorV2();
      holdSvc    = new HoldService(hostRepl);
      hostInput  = new HostInputDispatcher(holdSvc, (peerId) => getPeerSeatRef.current(peerId));
      EntityComponent.setHostReplicator(hostRepl);
      graph.setReplicator(hostRepl);
      dragCtrl   = new DragController(
        camera, renderer.domElement, holdSvc,
        () => getSelfSeatRef.current(), moveGizmo, selectCallback,
      );
      guestInput = new GuestInputHandler(holdSvc, (peerId) => getPeerSeatRef.current(peerId));

      spawnRef.current = (type) => graph.spawn(type, scene, physics!);

      rollRef.current = () => {
        for (const e of graph.getAll()) {
          if (e.objectType !== 'die' || !e.body) continue;
          e.body.wakeUp();
          e.body.angularVelocity.set(
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 40,
          );
          e.body.velocity.set((Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4);
        }
      };

      rollObjectRef.current = (id) => {
        const e = graph.getEntry(id);
        if (e?.objectType !== 'die' || !e.body) return;
        e.body.wakeUp();
        e.body.angularVelocity.set(
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 40,
        );
        e.body.velocity.set((Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4);
      };

      deleteObjectRef.current = (id) => graph.remove(id, scene, physics);

      updatePropRef.current = (id, key, value) => graph.updateProp(id, key, value);

      updateTablePropRef.current = (key, value) => applyTableProp(tableMesh, key, value);

      contextCtrl = new ContextMenuController(
        renderer.domElement, camera, true,
        () => getSelfSeatRef.current(),
        (req) => onContextMenuRef.current(req),
      );

      onMsgRef.current = (peerId, msg) => {
        if (msg.type === 'guest-drag-move')   { guestInput!.handleMessage(peerId, msg); return; }
        if (msg.type === 'hold-claim')        { hostInput!.handleHoldClaim(peerId, msg); return; }
        if (msg.type === 'hold-release')      { hostInput!.handleHoldRelease(peerId, msg); return; }
        if (msg.type === 'request-update')    { hostInput!.handleRequestUpdate(peerId, msg); return; }
        if (msg.type === 'invoke-action')     { hostInput!.handleInvokeAction(peerId, msg); return; }
        if (msg.type === 'cursor-position')   {
          // Update local view, then relay to other peers so guests see each
          // other (star topology — all guest traffic flows through the host).
          cursorTracker.update(msg.peerId, msg.seat, msg.x, msg.z);
          for (const t of getTargetsRef.current()) {
            if (t.peerId === peerId) continue;
            sendToRef.current(t.peerId, msg);
          }
          return;
        }
      };

      onPeerLeftRef.current = (peerId) => {
        guestInput!.releasePeer(peerId);
        cursorTracker.remove(peerId);
      };

      onPeerJoinedRef.current = (peerId) => {
        for (const entity of Scene.all()) {
          sendToRef.current(peerId, { type: 'entity-spawn', entity: entityToSerialized(entity) });
        }
      };

    } else {
      EntityComponent.setHostReplicator(null);
      graph.setReplicator(null);
      guestDrag   = new GuestDragController(
        camera, renderer.domElement, moveGizmo,
        (msg) => sendRef.current(msg),
        () => getSelfSeatRef.current(),
        selectCallback,
      );

      contextCtrl = new ContextMenuController(
        renderer.domElement, camera, false,
        () => getSelfSeatRef.current(),
        (req) => onContextMenuRef.current(req),
        () => highlightId,
      );

      onMsgRef.current = (_peerId, msg) => {
        if (msg.type === 'entity-spawn'      ||
            msg.type === 'entity-patch'      ||
            msg.type === 'component-patches' ||
            msg.type === 'despawn-batch'     ||
            msg.type === 'invoke-action'     ||
            msg.type === 'hold-claim'        ||
            msg.type === 'hold-release'      ||
            msg.type === 'request-update') {
          applySceneMessage(msg, { isHost: false, scene });
          graph.syncFromScene();
          return;
        }
        if (msg.type === 'cursor-position') {
          if (msg.peerId === getSelfPeerIdRef.current()) return; // skip echo
          cursorTracker.update(msg.peerId, msg.seat, msg.x, msg.z);
          return;
        }
      };

      onPeerLeftRef.current = (peerId) => {
        cursorTracker.remove(peerId);
      };
    }

    // ── Animation loop ────────────────────────────────────────────────────
    let lastTime = performance.now();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (isHost && physics && dragCtrl && hostRepl) {
        const now = performance.now();
        const dt  = Math.min((now - lastTime) / 1000, 0.05);
        lastTime  = now;

        physics.step(dt);
        graph.enforceTableBounds();
        dragCtrl.update();
        graph.syncFromPhysics();

        broadcast(hostRepl.flushUnreliable());
        broadcast(hostRepl.flushReliable());

        const dieFaces: string[] = [];
        for (const e of graph.getAll()) {
          if (e.objectType !== 'die' || !e.body) continue;
          const speed = e.body.velocity.length() + e.body.angularVelocity.length();
          if (speed < 0.1) {
            dieFaces.push(`D6: ${getDieFace(
              e.body.quaternion.x, e.body.quaternion.y,
              e.body.quaternion.z, e.body.quaternion.w,
            )}`);
          }
        }
        if (overlayRef.current) overlayRef.current.textContent = dieFaces.join('  |  ');

      } else if (!isHost) {
        guestDrag?.update();

        const dieFaces: string[] = [];
        for (const e of graph.getAll()) {
          if (e.objectType !== 'die') continue;
          const q = e.mesh.quaternion;
          dieFaces.push(`D6: ${getDieFace(q.x, q.y, q.z, q.w)}`);
        }
        if (overlayRef.current) overlayRef.current.textContent = dieFaces.join('  |  ');
      }

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
          });
        }
        cursorLastSent = cursorNow;
        cursorPending  = null;
      }
      cursorOverlay.sync(cursorTracker.all());

      if (highlightHelper) highlightHelper.update();
      moveGizmo.update();

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
      cursorOverlay.dispose();
      cursorTracker.clear();
      unsubscribe();
      clearHighlight();
      moveGizmo.dispose();
      camController.dispose();
      dragCtrl?.dispose();
      guestDrag?.dispose();
      contextCtrl?.dispose();
      EntityComponent.setHostReplicator(null);
      Scene.clear();
      if (!isHost) onMsgRef.current = () => {};
      onPeerLeftRef.current   = () => {};
      onPeerJoinedRef.current = () => {};
      spawnRef.current        = () => {};
      rollRef.current         = () => {};
      rollObjectRef.current   = () => {};
      deleteObjectRef.current = () => {};
      updatePropRef.current      = () => {};
      updateTablePropRef.current = () => {};
      freeCameraRef.current      = () => {};
      setHighlightRef.current    = () => {};
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [
    isHost, sendRef, sendToRef, getTargetsRef, getSelfSeatRef, getSelfPeerIdRef, getPeerSeatRef,
    onMsgRef, onPeerLeftRef, onPeerJoinedRef,
    spawnRef, rollRef, onContextMenuRef, rollObjectRef, deleteObjectRef,
    updatePropRef, updateTablePropRef, freeCameraRef, onObjectsChangeRef,
    onSelectRef, setHighlightRef,
  ]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        ref={overlayRef}
        style={{
          position: 'absolute', top: 8, left: 8,
          color: '#ffd740', fontSize: 14, fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.55)', padding: '3px 10px', borderRadius: 4,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
