// Host-side replicator for the v2 entity-component scene graph.
// Slice #2 of planning/issues/issues--scene-graph.md.
//
// Buffers per-component patches per channel per tick. Unreliable patches
// flush each physics step; reliable on a slower cadence. `entity-patch`,
// `despawn-batch`, `invoke-action`, `hold-*` are always reliable, regardless
// of source.
//
// This module is intentionally not wired into the runtime yet — slice #3
// engages it behind a feature flag, slice #4 cuts the legacy HostReplicator
// over wholesale.

import { type ReplicationChannel } from './EntityComponent';
import {
  type ComponentPatch,
  type ComponentPatchesMessage,
  type EntityPatch,
  type EntityFieldsPartial,
  type DespawnBatch,
  type InvokeAction,
  type HoldClaim,
  type HoldRelease,
  type SceneMessage,
} from './wire';

export class HostReplicatorV2 {
  private reliableComponentPatches:   ComponentPatch[] = [];
  private unreliableComponentPatches: ComponentPatch[] = [];
  private reliableMessages:           SceneMessage[]   = [];

  enqueueComponentPatch(patch: ComponentPatch, channel: ReplicationChannel): void {
    if (channel === 'unreliable') this.unreliableComponentPatches.push(patch);
    else                          this.reliableComponentPatches.push(patch);
  }

  enqueueEntityPatch(entityId: string, partial: EntityFieldsPartial): void {
    this.reliableMessages.push({ type: 'entity-patch', entityId, partial });
  }

  // Two atomic `entity-patch` entries (child `parentId` + parent `children`)
  // emitted contiguously so they flush together. Old parent's `children` is
  // the caller's concern (separate enqueueEntityPatch).
  enqueueReparent(
    childId:           string,
    newParentId:       string | null,
    newParentChildren: string[] | null,
  ): void {
    this.reliableMessages.push({
      type:     'entity-patch',
      entityId: childId,
      partial:  { parentId: newParentId },
    });
    if (newParentId !== null && newParentChildren !== null) {
      this.reliableMessages.push({
        type:     'entity-patch',
        entityId: newParentId,
        partial:  { children: newParentChildren },
      });
    }
  }

  enqueueDespawn(entityIds: string[]): void {
    this.reliableMessages.push({ type: 'despawn-batch', entityIds });
  }

  enqueueInvokeAction(msg: Omit<InvokeAction, 'type'>): void {
    this.reliableMessages.push({ type: 'invoke-action', ...msg });
  }

  enqueueHoldClaim(msg: Omit<HoldClaim, 'type'>): void {
    this.reliableMessages.push({ type: 'hold-claim', ...msg });
  }

  enqueueHoldRelease(msg: Omit<HoldRelease, 'type'>): void {
    this.reliableMessages.push({ type: 'hold-release', ...msg });
  }

  // Drains the unreliable buffer. Called per physics step. Returns at most
  // one envelope (containing all queued unreliable component patches).
  flushUnreliable(): SceneMessage[] {
    if (this.unreliableComponentPatches.length === 0) return [];
    const envelope: ComponentPatchesMessage = {
      type:    'component-patches',
      channel: 'unreliable',
      patches: this.unreliableComponentPatches,
    };
    this.unreliableComponentPatches = [];
    return [envelope];
  }

  // Drains the reliable buffer. Component patches are bundled into a single
  // envelope; standalone messages (entity-patch / despawn-batch / invoke /
  // hold-*) follow in enqueue order.
  flushReliable(): SceneMessage[] {
    const out: SceneMessage[] = [];
    if (this.reliableComponentPatches.length > 0) {
      out.push({
        type:    'component-patches',
        channel: 'reliable',
        patches: this.reliableComponentPatches,
      });
      this.reliableComponentPatches = [];
    }
    if (this.reliableMessages.length > 0) {
      out.push(...this.reliableMessages);
      this.reliableMessages = [];
    }
    return out;
  }

  hasPendingReliable(): boolean {
    return this.reliableComponentPatches.length > 0 || this.reliableMessages.length > 0;
  }

  hasPendingUnreliable(): boolean {
    return this.unreliableComponentPatches.length > 0;
  }
}
