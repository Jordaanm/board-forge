// Renders one flat circle on the table per remote peer cursor, coloured by
// that peer's seat. Reads from CursorTracker each frame and reconciles its
// own meshes (add/remove/update).

import * as THREE from 'three';
import { TABLE_SURFACE_Y } from '../scene/Table';
import { SEAT_COLOURS, type SeatIndex } from '../seats/SeatLayout';
import { type PeerCursor } from './CursorTracker';

const SPECTATOR_COLOR = '#888888';
const CURSOR_RADIUS   = 0.18;
const CURSOR_LIFT     = 0.02;   // offset above table surface to avoid z-fighting
const CURSOR_OPACITY  = 0.75;

interface PeerEntry {
  mesh:    THREE.Mesh;
  seat:    SeatIndex | null;
}

export class CursorOverlay {
  readonly group = new THREE.Group();
  private entries = new Map<string, PeerEntry>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  sync(cursors: readonly PeerCursor[]): void {
    const seen = new Set<string>();
    for (const c of cursors) {
      seen.add(c.peerId);
      let entry = this.entries.get(c.peerId);
      if (!entry) {
        entry = { mesh: makeCursorMesh(c.seat), seat: c.seat };
        this.group.add(entry.mesh);
        this.entries.set(c.peerId, entry);
      } else if (entry.seat !== c.seat) {
        (entry.mesh.material as THREE.MeshBasicMaterial).color.set(seatColor(c.seat));
        entry.seat = c.seat;
      }
      entry.mesh.position.set(c.x, TABLE_SURFACE_Y + CURSOR_LIFT, c.z);
    }

    for (const [peerId, entry] of this.entries) {
      if (seen.has(peerId)) continue;
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
      this.entries.delete(peerId);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.entries.clear();
    this.group.parent?.remove(this.group);
  }
}

function makeCursorMesh(seat: SeatIndex | null): THREE.Mesh {
  const geom = new THREE.CircleGeometry(CURSOR_RADIUS, 32);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color:       seatColor(seat),
    transparent: true,
    opacity:     CURSOR_OPACITY,
    depthTest:   false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 998;
  return mesh;
}

function seatColor(seat: SeatIndex | null): string {
  return seat === null ? SPECTATOR_COLOR : SEAT_COLOURS[seat];
}
