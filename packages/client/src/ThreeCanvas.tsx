import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { createTable, applyTableProp, type TableProps } from './scene/Table';
import { SceneGraph } from './scene/SceneGraph';
import { getDieFace } from './scene/objectTypes';
import { MoveGizmo } from './scene/MoveGizmo';
import { CameraController } from './camera/CameraController';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { DragController } from './input/DragController';
import { GuestDragController } from './input/GuestDragController';
import { GuestInputHandler } from './input/GuestInputHandler';
import { ContextMenuController, type ContextMenuRequest } from './input/ContextMenuController';
import { HostReplicator } from './net/HostReplicator';
import { GuestInterpolator } from './net/GuestInterpolator';
import { type ChannelMessage, type SpawnableType } from './net/SceneState';
import { type ObjectSummary } from './components/EditorPanel';

interface Props {
  isHost:              boolean;
  sendRef:             MutableRefObject<(msg: ChannelMessage) => void>;
  onMsgRef:            MutableRefObject<(msg: ChannelMessage) => void>;
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
  isHost, sendRef, onMsgRef, spawnRef, rollRef,
  onContextMenuRef, rollObjectRef, deleteObjectRef,
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
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 12, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const tableMesh = createTable();
    scene.add(tableMesh);

    const camController = new CameraController(camera, renderer.domElement);
    const graph         = new SceneGraph();

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

    // Push graph snapshots to React on every change. Also clean up a stale
    // highlight if the selected entry was just removed.
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
    let hostRepl:    HostReplicator      | null = null;
    let contextCtrl: ContextMenuController | null = null;
    let guestInterp: GuestInterpolator   | null = null;
    let guestDrag:   GuestDragController | null = null;

    if (isHost) {
      physics    = new PhysicsWorld();
      dragCtrl   = new DragController(camera, renderer.domElement, graph, selectCallback);
      guestInput = new GuestInputHandler();
      hostRepl   = new HostReplicator((msg) => sendRef.current(msg));

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

      deleteObjectRef.current = (id) => {
        graph.remove(id, scene, physics);
        sendRef.current({ type: 'delete', id });
      };

      updatePropRef.current = (id, key, value) => {
        graph.updateProp(id, key, value);
        sendRef.current({ type: 'update-props', id, props: { [key]: value } });
      };

      updateTablePropRef.current = (key, value) => {
        applyTableProp(tableMesh, key, value);
        sendRef.current({ type: 'table-update', props: { [key]: value } });
      };

      contextCtrl = new ContextMenuController(
        renderer.domElement, camera, graph,
        (req) => onContextMenuRef.current(req),
      );

      onMsgRef.current = (msg) => {
        if (msg.type === 'guest-drag-start' ||
            msg.type === 'guest-drag-move'  ||
            msg.type === 'guest-drag-end') {
          guestInput!.handleMessage(msg, graph);
        }
      };

    } else {
      guestInterp = new GuestInterpolator();
      guestDrag   = new GuestDragController(
        camera, renderer.domElement, graph,
        (msg) => sendRef.current(msg),
        selectCallback,
      );

      contextCtrl = new ContextMenuController(
        renderer.domElement, camera, graph,
        (req) => onContextMenuRef.current(req),
        () => highlightId,
      );

      onMsgRef.current = (msg) => {
        if (msg.type === 'snapshot' || msg.type === 'patch') {
          guestInterp!.receive(msg);
          const objects = msg.type === 'snapshot' ? msg.objects : msg.changed;
          graph.ensureObjects(objects, scene);
        } else if (msg.type === 'delete') {
          guestInterp!.receive(msg);
          graph.remove(msg.id, scene, null);
        } else if (msg.type === 'update-props') {
          graph.applyProps(msg.id, msg.props);
        } else if (msg.type === 'table-update') {
          for (const [k, v] of Object.entries(msg.props)) {
            applyTableProp(tableMesh, k as keyof TableProps, v);
          }
        }
      };
    }

    // ── Animation loop ────────────────────────────────────────────────────
    let lastTime = performance.now();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (isHost && physics && dragCtrl && guestInput && hostRepl) {
        const now = performance.now();
        const dt  = Math.min((now - lastTime) / 1000, 0.05);
        lastTime  = now;

        physics.step(dt);
        graph.enforceTableBounds();
        dragCtrl.update();
        guestInput.update(graph);
        graph.syncFromPhysics();
        hostRepl.update(graph.getPhysicsStates());

        // Die face overlay
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

      } else if (!isHost && guestInterp) {
        const states = guestInterp.update();
        graph.applyStates(states);
        guestDrag?.update();

        const dieFaces: string[] = [];
        for (const s of states) {
          if (s.objectType === 'die') {
            dieFaces.push(`D6: ${getDieFace(s.qx, s.qy, s.qz, s.qw)}`);
          }
        }
        if (overlayRef.current) overlayRef.current.textContent = dieFaces.join('  |  ');
      }

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
      unsubscribe();
      clearHighlight();
      moveGizmo.dispose();
      camController.dispose();
      dragCtrl?.dispose();
      guestDrag?.dispose();
      contextCtrl?.dispose();
      if (!isHost) onMsgRef.current = () => {};
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
    isHost, sendRef, onMsgRef, spawnRef, rollRef,
    onContextMenuRef, rollObjectRef, deleteObjectRef,
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
