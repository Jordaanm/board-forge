// Guest-side dispatcher for v2 scene replication messages.
// Slice #2 of planning/issues/issues--scene-graph.md.
//
// Routes inbound SceneMessages into the local Scene + Entity + Component
// state. Uses `applyRemoteState` for component patches so replication is not
// re-queued. `invoke-action` is host-only logic and is dropped on the guest.

import * as THREE from 'three';
import { Scene } from './Scene';
import { type EntityFieldsPartial, type SceneMessage } from './wire';
import { type Entity } from './Entity';
import { type SpawnContext } from './EntityComponent';

export interface GuestReceiveContext {
  // True on the host (where this dispatcher should ignore guest-only paths).
  isHost?: boolean;
  scene?: THREE.Scene;
}

export function applySceneMessage(msg: SceneMessage, ctx: GuestReceiveContext = {}): void {
  switch (msg.type) {
    case 'entity-spawn': {
      if (Scene.has(msg.entity.id)) return;
      if (!ctx.scene) return;
      const spawnCtx: SpawnContext = { scene: ctx.scene, physics: null };
      Scene.load([msg.entity], spawnCtx);
      return;
    }

    case 'component-patches': {
      for (const p of msg.patches) {
        const entity = Scene.getEntity(p.entityId);
        if (!entity) continue;
        const comp = entity.components.get(p.typeId);
        if (!comp) continue;
        comp.applyRemoteState(p.partial);
      }
      return;
    }

    case 'entity-patch': {
      const entity = Scene.getEntity(msg.entityId);
      if (!entity) return;
      mergeEntityFields(entity, msg.partial);
      return;
    }

    case 'despawn-batch': {
      // Reverse-tree order from the host. We delete in the given order; any
      // residual references in surviving entities' `children` arrays are the
      // host's job to fix up via accompanying entity-patches. Components run
      // onDespawn so view artefacts get torn down.
      const spawnCtx: SpawnContext = { scene: ctx.scene ?? new THREE.Scene(), physics: null };
      for (const id of msg.entityIds) {
        Scene.despawn(id, spawnCtx);
      }
      return;
    }

    case 'invoke-action':
      // Host-only path. Guest received a copy (e.g. via broadcast) — drop it.
      return;

    case 'hold-claim': {
      const entity = Scene.getEntity(msg.entityId);
      if (!entity) return;
      entity.heldBy = msg.seat;
      return;
    }

    case 'hold-release': {
      const entity = Scene.getEntity(msg.entityId);
      if (!entity) return;
      entity.heldBy = null;
      return;
    }

    case 'request-update':
      // Host-only inbound path. Guest never receives these.
      return;
  }
}

// Entity-level field merge. Arrays are replaced wholesale (matches PRD's
// `partial` semantics — sender computes the new value).
function mergeEntityFields(entity: Entity, partial: EntityFieldsPartial): void {
  if (partial.name          !== undefined) entity.name          = partial.name;
  if (partial.tags          !== undefined) entity.tags          = [...partial.tags];
  if (partial.owner         !== undefined) entity.owner         = partial.owner;
  if (partial.privateToSeat !== undefined) entity.privateToSeat = partial.privateToSeat;
  if (partial.parentId      !== undefined) entity.parentId      = partial.parentId;
  if (partial.children      !== undefined) entity.children      = [...partial.children];
}
