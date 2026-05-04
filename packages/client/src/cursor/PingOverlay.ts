// PingOverlay — issue #4 of issues--tools.md.
//
// Sibling of CursorOverlay. Listens for inbound `tool-broadcast` envelopes
// where toolId === 'ping' and renders an ephemeral ring + upward beam at the
// target's table-plane position. Pings anchored to an entity follow that
// entity over their lifetime; pings on a point sit fixed. Lifetime ~1.5s,
// after which all GPU resources are disposed.

import * as THREE from 'three';
import { TABLE_SURFACE_Y } from '../scene/Table';
import { SEAT_COLOURS, type SeatIndex } from '../seats/SeatLayout';
import { type ToolBroadcast } from '../entity/wire';
import { type World } from '../entity/world';
import { TransformComponent } from '../entity/components/TransformComponent';

const SPECTATOR_COLOR = '#888888';

const PING_LIFETIME_MS    = 1500;
const RING_RADIUS_START   = 0.15;
const RING_RADIUS_END     = 0.55;
const RING_TUBE           = 0.025;
const RING_LIFT           = 0.025;
const BEAM_HEIGHT         = 1.6;
const BEAM_RADIUS         = 0.04;

interface PingPayloadEntity { entityId: string }
interface PingPayloadPoint  { point: [number, number] }
type PingPayload = PingPayloadEntity | PingPayloadPoint;

interface ActivePing {
  group:    THREE.Group;
  ring:     THREE.Mesh;
  beam:     THREE.Mesh;
  ringMat:  THREE.MeshBasicMaterial;
  beamMat:  THREE.MeshBasicMaterial;
  bornMs:   number;
  // Set for entity-anchored pings; null for point pings.
  entityId: string | null;
  // Used for point-anchored pings (and as a fallback if the entity despawns).
  pointX:   number;
  pointZ:   number;
}

export class PingOverlay {
  readonly group = new THREE.Group();
  private readonly pings: ActivePing[] = [];
  // Test seam — overridden via `(overlay as any).now = () => ...`. Production
  // uses performance.now().
  private now: () => number = () => performance.now();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {
    scene.add(this.group);
  }

  // Ingest an inbound tool-broadcast. Filters by toolId; non-ping envelopes
  // are ignored. Caller is responsible for routing the broadcast here (via
  // World.onToolBroadcast).
  ingest(msg: ToolBroadcast): void {
    if (msg.toolId !== 'ping') return;
    const payload = msg.payload as PingPayload | undefined;
    if (!payload) return;
    const target = this.resolveTarget(payload);
    if (!target) return;
    this.spawnPing(msg.seat, target.entityId, target.x, target.z);
  }

  // Per-frame tick. Updates entity-anchored pings to follow their target,
  // animates ring radius + beam fade, and disposes expired pings.
  update(_dt: number): void {
    const now = this.now();
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      const elapsed = now - p.bornMs;
      if (elapsed >= PING_LIFETIME_MS) {
        this.disposePing(p);
        this.pings.splice(i, 1);
        continue;
      }

      // Entity-anchored: follow the entity's transform. If the entity has
      // despawned mid-lifetime, end early without erroring.
      if (p.entityId) {
        const t = this.world.get(p.entityId)?.get(TransformComponent);
        if (!t) {
          this.disposePing(p);
          this.pings.splice(i, 1);
          continue;
        }
        const [x, _y, z] = t.state.position;
        p.pointX = x;
        p.pointZ = z;
      }
      p.group.position.set(p.pointX, TABLE_SURFACE_Y, p.pointZ);

      const t01 = elapsed / PING_LIFETIME_MS;
      const ringRadius = RING_RADIUS_START + (RING_RADIUS_END - RING_RADIUS_START) * t01;
      p.ring.scale.set(ringRadius / RING_RADIUS_START, 1, ringRadius / RING_RADIUS_START);
      const fade = 1 - t01;
      p.ringMat.opacity = fade;
      p.beamMat.opacity = fade * 0.7;
    }
  }

  dispose(): void {
    for (const p of this.pings) this.disposePing(p);
    this.pings.length = 0;
    this.group.parent?.remove(this.group);
  }

  pingCount(): number {
    return this.pings.length;
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private resolveTarget(payload: PingPayload): { x: number; z: number; entityId: string | null } | null {
    if ('entityId' in payload) {
      const t = this.world.get(payload.entityId)?.get(TransformComponent);
      if (!t) return null;
      const [x, _y, z] = t.state.position;
      return { x, z, entityId: payload.entityId };
    }
    if ('point' in payload && Array.isArray(payload.point) && payload.point.length === 2) {
      return { x: payload.point[0], z: payload.point[1], entityId: null };
    }
    return null;
  }

  private spawnPing(seat: SeatIndex | null, entityId: string | null, x: number, z: number): void {
    const color = seat === null ? SPECTATOR_COLOR : SEAT_COLOURS[seat];

    const ringGeom = new THREE.TorusGeometry(RING_RADIUS_START, RING_TUBE, 8, 48);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, depthTest: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.y = RING_LIFT;
    ring.renderOrder = 1000;

    const beamGeom = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, depthTest: false,
    });
    const beam = new THREE.Mesh(beamGeom, beamMat);
    beam.position.y = BEAM_HEIGHT / 2;
    beam.renderOrder = 1000;

    const group = new THREE.Group();
    group.position.set(x, TABLE_SURFACE_Y, z);
    group.add(ring);
    group.add(beam);
    this.group.add(group);

    this.pings.push({
      group, ring, beam, ringMat, beamMat,
      bornMs: this.now(),
      entityId, pointX: x, pointZ: z,
    });
  }

  private disposePing(p: ActivePing): void {
    this.group.remove(p.group);
    p.ring.geometry.dispose();
    p.beam.geometry.dispose();
    p.ringMat.dispose();
    p.beamMat.dispose();
  }
}
