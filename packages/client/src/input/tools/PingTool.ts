// PingTool — issue #4 of issues--tools.md.
//
// Click on a piece → broadcast a ping anchored to that entity.
// Click on empty table space → broadcast a ping at that table-plane point.
// Click on nothing pickable → no broadcast.
// Sender-side 500ms rate limit; spectators may use it (no canManipulate gate).
// Ownership / lock state are irrelevant — pings are cosmetic.

import * as THREE from 'three';
import { TABLE_SURFACE_Y, TABLE_WIDTH, TABLE_DEPTH } from '../../scene/Table';
import { TransformComponent } from '../../entity/components/TransformComponent';
import { type Tool, type ToolContext, type ToolPointerEvent } from './types';

const MOVE_PX           = 5;
const RATE_LIMIT_MS     = 500;

interface Pending {
  pointerId: number;
  startX:    number;
  startY:    number;
  moved:     boolean;
}

export class PingTool implements Tool {
  readonly id     = 'ping';
  readonly label  = 'Ping';
  readonly hotkey = '2';

  private pending:        Pending | null = null;
  private lastFiredMs:    number = -Infinity;

  // Test seam — overridden by tests via `(tool as any).now = () => ...`. The
  // dispatcher uses performance.now() everywhere else.
  private now: () => number = () => performance.now();

  hasActiveGesture(): boolean {
    return this.pending !== null;
  }

  onPress(e: ToolPointerEvent, _ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.pending = {
      pointerId: e.pointerId,
      startX:    e.clientX,
      startY:    e.clientY,
      moved:     false,
    };
  }

  onMove(e: ToolPointerEvent, _ctx: ToolContext): void {
    if (!this.pending) return;
    const dx = e.clientX - this.pending.startX;
    const dy = e.clientY - this.pending.startY;
    if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) this.pending.moved = true;
  }

  onRelease(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const pending = this.pending;
    this.pending = null;
    if (!pending || pending.moved) return;

    // Rate-limit: drop sender-side if within window.
    const t = this.now();
    if (t - this.lastFiredMs < RATE_LIMIT_MS) return;

    const payload = this.resolveTarget(e, ctx);
    if (!payload) return;

    this.lastFiredMs = t;
    ctx.world.broadcastToolMessage(this.id, payload);
  }

  onCancel(_ctx: ToolContext): void {
    this.pending = null;
  }

  // Public for tests — returns the payload for a pointer event without
  // sending. The unit test for the rate limiter doesn't need this; it
  // exercises onRelease directly with a stubbed world.
  private resolveTarget(e: ToolPointerEvent, ctx: ToolContext): unknown | null {
    ctx.raycaster.set(e.ray.origin, e.ray.direction);
    // Hit entity?
    const meshes: THREE.Object3D[] = [];
    ctx.world.forEach((h) => {
      const t = h.get(TransformComponent);
      if (t?.object3d) meshes.push(t.object3d);
    });
    const entityHits = ctx.raycaster.intersectObjects(meshes, true);
    if (entityHits.length > 0) {
      const handle = ctx.world.pickByObject3D(entityHits[0].object);
      if (handle) return { entityId: handle.id };
    }

    // Hit empty table plane?
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_SURFACE_Y);
    const hit = new THREE.Vector3();
    if (!ctx.raycaster.ray.intersectPlane(plane, hit)) return null;
    if (Math.abs(hit.x) > TABLE_WIDTH / 2 || Math.abs(hit.z) > TABLE_DEPTH / 2) return null;
    return { point: [hit.x, hit.z] };
  }
}
