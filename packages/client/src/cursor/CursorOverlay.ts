// Renders one flat circle on the table per remote peer cursor, coloured by
// that peer's seat. Reads from CursorTracker each frame and reconciles its
// own meshes (add/remove/update). Issue #3 of issues--tools.md adds an inner
// per-tool decoration ring driven by the optional `tool` field on the cursor
// message — an empty / missing tool field renders just the base circle.

import * as THREE from 'three';
import { TABLE_SURFACE_Y } from '../scene/Table';
import { SEAT_COLOURS, type SeatIndex } from '../seats/SeatLayout';
import { type PeerCursor } from './CursorTracker';

const SPECTATOR_COLOR = '#888888';
const CURSOR_RADIUS   = 0.18;
const CURSOR_LIFT     = 0.02;   // offset above table surface to avoid z-fighting
const CURSOR_OPACITY  = 0.75;

const DECORATION_RADIUS  = 0.07;
const DECORATION_LIFT    = 0.005;  // tiny extra lift so it renders on top
const DECORATION_OPACITY = 0.95;

interface ToolDecoration {
  // Renders an inner mesh inside the cursor circle. null → no decoration.
  color: string;
}

// Per-tool decoration map. Tools without an entry render no decoration.
// Visual treatment is intentionally minimal here (a single inner colour);
// future tools can introduce richer decoration kinds (rings, glyphs, etc.)
// without changing the wire surface.
const TOOL_DECORATIONS: Record<string, ToolDecoration> = {
  grab: { color: '#ffffff' },
};

interface PeerEntry {
  mesh:           THREE.Mesh;
  decoration:     THREE.Mesh | null;
  seat:           SeatIndex | null;
  tool:           string | undefined;
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
        const mesh = makeCursorMesh(c.seat);
        entry = { mesh, decoration: null, seat: c.seat, tool: undefined };
        this.group.add(entry.mesh);
        this.entries.set(c.peerId, entry);
      } else if (entry.seat !== c.seat) {
        (entry.mesh.material as THREE.MeshBasicMaterial).color.set(seatColor(c.seat));
        entry.seat = c.seat;
      }
      entry.mesh.position.set(c.x, TABLE_SURFACE_Y + CURSOR_LIFT, c.z);
      if (entry.tool !== c.tool) {
        this.applyDecoration(entry, c.tool);
      }
      if (entry.decoration) {
        entry.decoration.position.set(c.x, TABLE_SURFACE_Y + CURSOR_LIFT + DECORATION_LIFT, c.z);
      }
    }

    for (const [peerId, entry] of this.entries) {
      if (seen.has(peerId)) continue;
      this.disposeEntry(entry);
      this.entries.delete(peerId);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.group.parent?.remove(this.group);
  }

  private applyDecoration(entry: PeerEntry, tool: string | undefined): void {
    if (entry.decoration) {
      this.group.remove(entry.decoration);
      entry.decoration.geometry.dispose();
      (entry.decoration.material as THREE.Material).dispose();
      entry.decoration = null;
    }
    entry.tool = tool;
    if (!tool) return;
    const dec = TOOL_DECORATIONS[tool];
    if (!dec) return;
    entry.decoration = makeDecorationMesh(dec.color);
    this.group.add(entry.decoration);
  }

  private disposeEntry(entry: PeerEntry): void {
    this.group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    if (entry.decoration) {
      this.group.remove(entry.decoration);
      entry.decoration.geometry.dispose();
      (entry.decoration.material as THREE.Material).dispose();
      entry.decoration = null;
    }
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

function makeDecorationMesh(color: string): THREE.Mesh {
  const geom = new THREE.CircleGeometry(DECORATION_RADIUS, 24);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity:     DECORATION_OPACITY,
    depthTest:   false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 999;
  return mesh;
}

function seatColor(seat: SeatIndex | null): string {
  return seat === null ? SPECTATOR_COLOR : SEAT_COLOURS[seat];
}
