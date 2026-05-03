import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { createTable, applyTableProp, type TableProps } from './scene/Table';
import { createWorld } from './entity/world';
import { type World, type WorldTransport, type WorldInboundMessage } from './entity/world';
import { type Entity } from './entity/Entity';
import { TransformComponent } from './entity/components/TransformComponent';
import { MeshComponent } from './entity/components/MeshComponent';
import { ValueComponent } from './entity/components/ValueComponent';
import { DiceComponent } from './entity/components/DiceComponent';
import { MoveGizmo } from './scene/MoveGizmo';
import { CameraController } from './camera/CameraController';
import { DragController } from './input/DragController';
import { ContextMenuController, type ContextMenuRequest } from './input/ContextMenuController';
import { type ChannelMessage, type SpawnableType } from './net/SceneState';
import { type SeatIndex } from './seats/SeatLayout';
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
  deleteObjectRef:     MutableRefObject<(id: string) => void>;
  updatePropRef:       MutableRefObject<(id: string, key: string, value: unknown) => void>;
  updateTablePropRef:  MutableRefObject<(key: keyof TableProps, value: unknown) => void>;
  freeCameraRef:       MutableRefObject<(on: boolean) => void>;
  onObjectsChangeRef:  MutableRefObject<(objects: ObjectSummary[]) => void>;
  onSelectRef:         MutableRefObject<(id: string | null) => void>;
  setHighlightRef:     MutableRefObject<(id: string | null) => void>;
  getEntityRef:        MutableRefObject<(id: string) => Entity | undefined>;
}

export function ThreeCanvas({
  isHost, sendRef, sendToRef, getTargetsRef, getSelfSeatRef, getSelfPeerIdRef, getPeerSeatRef,
  onMsgRef, onPeerLeftRef, onPeerJoinedRef,
  spawnRef, rollRef, onContextMenuRef, deleteObjectRef,
  updatePropRef, updateTablePropRef, freeCameraRef, onObjectsChangeRef,
  onSelectRef, setHighlightRef, getEntityRef,
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

    // ── World transport adapter ─────────────────────────────────────────
    // Wraps the existing send / sendTo refs and exposes inbound subscription
    // hooks. Cursor traffic continues to flow outside the World — it isn't a
    // SceneMessage. Issue #7 replaces this inline adapter with RtcTransport.
    const worldHandlers:         Array<(peerId: string, msg: WorldInboundMessage) => void> = [];
    const worldPeerJoinHandlers: Array<(peerId: string) => void> = [];

    const worldTransport: WorldTransport = {
      send:   (msg)         => sendRef.current(msg),
      sendTo: (peerId, msg) => sendToRef.current(peerId, msg),
      onMessage: (h) => {
        worldHandlers.push(h);
        return () => {
          const i = worldHandlers.indexOf(h);
          if (i >= 0) worldHandlers.splice(i, 1);
        };
      },
      onPeerJoin: (h) => {
        worldPeerJoinHandlers.push(h);
        return () => {
          const i = worldPeerJoinHandlers.indexOf(h);
          if (i >= 0) worldPeerJoinHandlers.splice(i, 1);
        };
      },
    };

    const world: World = createWorld({
      role:                  isHost ? 'host' : 'guest',
      scene,
      identity: {
        isHost,
        selfSeat:   () => getSelfSeatRef.current(),
        selfPeerId: () => getSelfPeerIdRef.current(),
      },
      transport:             worldTransport,
      getReplicationTargets: isHost ? () => getTargetsRef.current() : undefined,
      getPeerSeat:           isHost ? (peerId) => getPeerSeatRef.current(peerId) : undefined,
    });

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
      const handle = world.get(id);
      const obj    = handle?.get(TransformComponent)?.object3d;
      if (!obj) return;
      highlightHelper = new THREE.BoxHelper(obj, 0xffd740);
      (highlightHelper.material as THREE.LineBasicMaterial).linewidth = 2;
      scene.add(highlightHelper);
      moveGizmo.attach(obj);
      scene.add(moveGizmo.group);
    };

    const selectCallback = (id: string | null) => onSelectRef.current(id);

    const unsubscribe = world.subscribe(() => {
      if (highlightId && !world.get(highlightId)) {
        highlightId = null;
        clearHighlight();
      }
      onObjectsChangeRef.current(world.all().map(h => entityToObjectSummary(h.entity)));
    });

    // ── Input wiring ────────────────────────────────────────────────────
    // One DragController works for both roles — issue #3. EntityHandle's
    // mutation verbs route to host body writes / HoldService directly on the
    // host, and to RPCs + optimistic transform updates on the guest.
    const dragCtrl = new DragController(
      camera, renderer.domElement, world,
      () => getSelfSeatRef.current(), moveGizmo, selectCallback,
    );

    const contextCtrl = new ContextMenuController(
      renderer.domElement, camera, isHost, world,
      () => getSelfSeatRef.current(),
      (req) => onContextMenuRef.current(req),
    );

    getEntityRef.current = (id) => world.get(id)?.entity;

    if (isHost) {
      spawnRef.current        = (type) => { world.spawn(type); };
      deleteObjectRef.current = (id)   => world.despawn(id);
      updatePropRef.current   = (id, key, value) => world.updateProp(id, key, value);

      rollRef.current = () => {
        world.forEach((h) => h.entity.getComponent(DiceComponent)?.roll());
      };

      updateTablePropRef.current = (key, value) => applyTableProp(tableMesh, key, value);
    }

    // ── Inbound message router ──────────────────────────────────────────
    // Cursor traffic stays here (not a SceneMessage). Everything else is
    // forwarded into worldTransport so World's inbound dispatch handles it.
    onMsgRef.current = (peerId, msg) => {
      if (msg.type === 'cursor-position') {
        if (isHost) {
          // Star topology: host relays each guest's cursor to all other peers.
          cursorTracker.update(msg.peerId, msg.seat, msg.x, msg.z);
          for (const t of getTargetsRef.current()) {
            if (t.peerId === peerId) continue;
            sendToRef.current(t.peerId, msg);
          }
        } else {
          if (msg.peerId === getSelfPeerIdRef.current()) return; // skip echo
          cursorTracker.update(msg.peerId, msg.seat, msg.x, msg.z);
        }
        return;
      }
      for (const h of worldHandlers) h(peerId, msg as WorldInboundMessage);
    };

    onPeerLeftRef.current = (peerId) => {
      world.releasePeer(peerId);
      cursorTracker.remove(peerId);
    };

    onPeerJoinedRef.current = (peerId) => {
      world.replayTo(peerId);
      for (const h of worldPeerJoinHandlers) h(peerId);
    };

    // ── Animation loop ────────────────────────────────────────────────────
    let lastTime = performance.now();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const now = performance.now();
      const dt  = Math.min((now - lastTime) / 1000, 0.05);
      lastTime  = now;

      world.tick(dt);
      dragCtrl.update();

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
      dragCtrl.dispose();
      contextCtrl.dispose();
      world.dispose();
      onMsgRef.current        = () => {};
      onPeerLeftRef.current   = () => {};
      onPeerJoinedRef.current = () => {};
      spawnRef.current        = () => {};
      rollRef.current         = () => {};
      deleteObjectRef.current = () => {};
      updatePropRef.current      = () => {};
      updateTablePropRef.current = () => {};
      freeCameraRef.current      = () => {};
      setHighlightRef.current    = () => {};
      getEntityRef.current       = () => undefined;
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [
    isHost, sendRef, sendToRef, getTargetsRef, getSelfSeatRef, getSelfPeerIdRef, getPeerSeatRef,
    onMsgRef, onPeerLeftRef, onPeerJoinedRef,
    spawnRef, rollRef, onContextMenuRef, deleteObjectRef,
    updatePropRef, updateTablePropRef, freeCameraRef, onObjectsChangeRef,
    onSelectRef, setHighlightRef, getEntityRef,
  ]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// Editor-panel view of an entity. Mirrors SceneSystemV2.derivePropsView until
// issue #4 migrates EditorPanel to read components directly.
function entityToObjectSummary(entity: Entity): ObjectSummary {
  const mesh  = entity.getComponent(MeshComponent);
  const value = entity.getComponent(ValueComponent);
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
  }
  return {
    id:         entity.id,
    objectType: entity.type as SpawnableType,
    tags:       [...entity.tags],
    props,
  };
}
