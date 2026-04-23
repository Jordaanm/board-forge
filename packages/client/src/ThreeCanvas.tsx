import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createTable } from './scene/Table';
import { createTokenMesh, createTokenBody } from './scene/Token';
import { CameraController } from './camera/CameraController';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { DragController } from './input/DragController';
import { HostReplicator } from './net/HostReplicator';
import { GuestInterpolator } from './net/GuestInterpolator';
import type { GameMessage, ObjectState } from './net/SceneState';

interface Props {
  isHost: boolean;
  sendRef:  React.MutableRefObject<(msg: GameMessage) => void>;
  onMsgRef: React.MutableRefObject<(msg: GameMessage) => void>;
}

export function ThreeCanvas({ isHost, sendRef, onMsgRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Renderer ────────────────────────────────────────────────────────────
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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 12, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    scene.add(createTable());

    const tokenMesh = createTokenMesh();
    scene.add(tokenMesh);

    const camController = new CameraController(camera, renderer.domElement);

    // ── Host-only setup ──────────────────────────────────────────────────────
    let physics:      PhysicsWorld  | null = null;
    let dragCtrl:     DragController | null = null;
    let hostRepl:     HostReplicator | null = null;
    let guestInterp:  GuestInterpolator | null = null;
    // cannon-es Body ref for host (accessed in animate closure)
    let tokenBodyRef: ReturnType<typeof createTokenBody> | null = null;

    if (isHost) {
      physics = new PhysicsWorld();
      const body = createTokenBody();
      tokenBodyRef = body;
      physics.addBody(body);
      dragCtrl  = new DragController(camera, renderer.domElement, tokenMesh, body);
      hostRepl  = new HostReplicator((msg) => sendRef.current(msg));
    } else {
      guestInterp = new GuestInterpolator();
      onMsgRef.current = (msg) => guestInterp!.receive(msg);
    }

    // ── Animation loop ───────────────────────────────────────────────────────
    let lastTime = performance.now();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (isHost && physics && dragCtrl && hostRepl && tokenBodyRef) {
        const now = performance.now();
        const dt  = Math.min((now - lastTime) / 1000, 0.05);
        lastTime  = now;

        physics.step(dt);
        dragCtrl.update();

        tokenMesh.position.set(
          tokenBodyRef.position.x, tokenBodyRef.position.y, tokenBodyRef.position.z,
        );
        tokenMesh.quaternion.set(
          tokenBodyRef.quaternion.x, tokenBodyRef.quaternion.y,
          tokenBodyRef.quaternion.z, tokenBodyRef.quaternion.w,
        );

        const objects: ObjectState[] = [{
          id: 'token-0',
          px: tokenBodyRef.position.x, py: tokenBodyRef.position.y, pz: tokenBodyRef.position.z,
          qx: tokenBodyRef.quaternion.x, qy: tokenBodyRef.quaternion.y,
          qz: tokenBodyRef.quaternion.z, qw: tokenBodyRef.quaternion.w,
        }];
        hostRepl.update(objects);

      } else if (!isHost && guestInterp) {
        for (const s of guestInterp.update()) {
          if (s.id === 'token-0') {
            tokenMesh.position.set(s.px, s.py, s.pz);
            tokenMesh.quaternion.set(s.qx, s.qy, s.qz, s.qw);
          }
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    // ── Resize ───────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      camController.dispose();
      dragCtrl?.dispose();
      if (!isHost) onMsgRef.current = () => {};
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [isHost, sendRef, onMsgRef]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
