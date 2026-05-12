// Host-side glue for resolveSnap. Walks the live scene to build the candidate
// list (world-resolved per-point pose + radius), traverses descendants for the
// self-exclusion set, and packages everything into the pure module's input.
//
// Issue #3 of planning/issues--snap.md. Called from HoldService.release.

import * as THREE from 'three';
import { type Entity } from '../Entity';
import { type EntityScene } from '../EntityComponent';
import { TransformComponent } from '../components/TransformComponent';
import { SnapPointsComponent } from '../components/SnapPointsComponent';
import { type SnapCandidate } from './resolveSnap';

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpLocal = new THREE.Vector3();

export function gatherSnapCandidates(scene: EntityScene): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const owner of scene.all()) {
    const comp = owner.getComponent(SnapPointsComponent);
    if (!comp) continue;
    const t = owner.getComponent(TransformComponent);
    if (!t) continue;
    const [px, py, pz]     = t.state.position;
    const [qx, qy, qz, qw] = t.state.rotation;
    tmpQ.set(qx, qy, qz, qw);
    const ownerYaw = extractYaw(tmpQ);
    tmpM.compose(new THREE.Vector3(px, py, pz), tmpQ, new THREE.Vector3(1, 1, 1));
    for (const point of comp.state.points) {
      tmpLocal.set(point.localPos[0], point.localPos[1], point.localPos[2]);
      tmpV.copy(tmpLocal).applyMatrix4(tmpM);
      out.push({
        ownerEntityId: owner.id,
        worldPos:      [tmpV.x, tmpV.y, tmpV.z],
        worldYaw:      ownerYaw + point.localYaw,
        snapRotation:  point.snapRotation,
        // Coerce — legacy saves predate this field and read as undefined.
        snapY:         point.snapY === true,
        radius:        point.radius,
      });
    }
  }
  return out;
}

// BFS through the scene-graph (Entity.children string-id arrays) collecting
// descendants of `rootId`. The root itself is NOT included — caller layers in
// the self-exclusion separately via SnapInput.droppedEntityId.
export function collectDescendantIds(scene: EntityScene, rootId: string): Set<string> {
  const out = new Set<string>();
  const root = scene.getEntity(rootId);
  if (!root) return out;
  const queue: Entity[] = [...root.children.map(id => scene.getEntity(id)).filter((e): e is Entity => e !== undefined)];
  while (queue.length > 0) {
    const e = queue.shift()!;
    if (out.has(e.id)) continue;
    out.add(e.id);
    for (const childId of e.children) {
      const child = scene.getEntity(childId);
      if (child) queue.push(child);
    }
  }
  return out;
}

// Yaw = rotation around Y. Decomposes the quaternion's YXZ Euler — for the
// "card lying flat" cases this is exactly the heading.
export function extractYaw(q: THREE.Quaternion): number {
  // Equivalent to new THREE.Euler().setFromQuaternion(q, 'YXZ').y, inlined
  // to avoid the temporary allocation.
  const { x, y, z, w } = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

export function yawToQuat(yaw: number): [number, number, number, number] {
  const half = yaw * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}
