import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createTable } from './scene/Table';
import { createTokenMesh, createTokenBody } from './scene/Token';
import { CameraController } from './camera/CameraController';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { DragController } from './input/DragController';

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
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

    const physics = new PhysicsWorld();
    const tokenBody = createTokenBody();
    physics.addBody(tokenBody);

    const camController = new CameraController(camera, renderer.domElement);
    const dragController = new DragController(camera, renderer.domElement, tokenMesh, tokenBody);

    let lastTime = performance.now();
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      physics.step(dt);
      dragController.update();

      tokenMesh.position.set(tokenBody.position.x, tokenBody.position.y, tokenBody.position.z);
      tokenMesh.quaternion.set(
        tokenBody.quaternion.x,
        tokenBody.quaternion.y,
        tokenBody.quaternion.z,
        tokenBody.quaternion.w,
      );

      renderer.render(scene, camera);
    };
    animate();

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
      dragController.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
