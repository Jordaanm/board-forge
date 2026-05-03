// Host-side replicator for the v2 entity-component scene graph.
// Issue #10 of issues--arch.md restructured this around ReplicationPolicy:
// component patches are coalesced per (channel, typeId, entityId) so a flood
// of intra-tick setStates collapses into one wire patch per entity, and per-
// typeId flush cadence is gated by `policy.shouldFlush`.

import { type ReplicationChannel, type ComponentReplicator } from './EntityComponent';
import {
  type ComponentPatch,
  type ComponentPatchesMessage,
  type EntityFieldsPartial,
  type EntitySerialized,
  type InvokeAction,
  type HoldClaim,
  type HoldRelease,
  type SceneMessage,
} from './wire';

// Same shape as ReplicationPolicy in entity/world/types.ts but redeclared
// locally to avoid a layering cycle (HostReplicatorV2 lives below the world
// module). World passes its policy in via the constructor.
export interface ReplicatorPolicy {
  channelFor(typeId: string): ReplicationChannel;
  coalesceFor(typeId: string): 'merge' | 'replace' | 'last-write-wins';
  shouldFlush(typeId: string, ctx: { tick: number; nowMs: number }): boolean;
}

export interface FlushContext {
  tick:  number;
  nowMs: number;
}

interface ChannelBuffer {
  // typeId → entityId → coalesced patch
  byType: Map<string, Map<string, ComponentPatch>>;
}

function emptyBuffer(): ChannelBuffer {
  return { byType: new Map() };
}

export class HostReplicatorV2 implements ComponentReplicator {
  private reliableComponents:   ChannelBuffer = emptyBuffer();
  private unreliableComponents: ChannelBuffer = emptyBuffer();
  private reliableMessages:     SceneMessage[] = [];

  constructor(private readonly policy: ReplicatorPolicy) {}

  enqueueComponentPatch(patch: ComponentPatch): void {
    const channel  = this.policy.channelFor(patch.typeId);
    const coalesce = this.policy.coalesceFor(patch.typeId);
    const buffer   = channel === 'unreliable' ? this.unreliableComponents : this.reliableComponents;
    let byEntity   = buffer.byType.get(patch.typeId);
    if (!byEntity) {
      byEntity = new Map();
      buffer.byType.set(patch.typeId, byEntity);
    }
    const existing = byEntity.get(patch.entityId);
    if (!existing) {
      byEntity.set(patch.entityId, {
        entityId: patch.entityId,
        typeId:   patch.typeId,
        partial:  { ...patch.partial },
      });
      return;
    }
    if (coalesce === 'merge') {
      // Object.assign keeps any keys from the prior patch that the new patch
      // doesn't overwrite. last-write per key.
      Object.assign(existing.partial, patch.partial);
    } else {
      // 'replace' / 'last-write-wins' — drop prior keys; the latest setState
      // is assumed to carry everything the receiver needs.
      existing.partial = { ...patch.partial };
    }
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

  enqueueEntitySpawn(entity: EntitySerialized): void {
    this.reliableMessages.push({ type: 'entity-spawn', entity });
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
    const out: HoldRelease = { type: 'hold-release', entityId: msg.entityId };
    if (msg.vx !== undefined) out.vx = msg.vx;
    if (msg.vy !== undefined) out.vy = msg.vy;
    if (msg.vz !== undefined) out.vz = msg.vz;
    this.reliableMessages.push(out);
  }

  // Drains the unreliable buffer for typeIds that pass `policy.shouldFlush`.
  // Buffered patches for deferred typeIds remain for the next eligible tick.
  flushUnreliable(ctx: FlushContext = { tick: 0, nowMs: 0 }): SceneMessage[] {
    const patches = drainEligible(this.unreliableComponents, this.policy, ctx);
    if (patches.length === 0) return [];
    const envelope: ComponentPatchesMessage = {
      type:    'component-patches',
      channel: 'unreliable',
      patches,
    };
    return [envelope];
  }

  // Drains the reliable buffer + standalone messages. Component patches for
  // deferred typeIds stay buffered; standalone entity-spawn / entity-patch /
  // despawn / hold-* always flush (they have no shouldFlush gate).
  flushReliable(ctx: FlushContext = { tick: 0, nowMs: 0 }): SceneMessage[] {
    const out: SceneMessage[] = [];
    const patches = drainEligible(this.reliableComponents, this.policy, ctx);
    if (patches.length > 0) {
      out.push({ type: 'component-patches', channel: 'reliable', patches });
    }
    if (this.reliableMessages.length > 0) {
      out.push(...this.reliableMessages);
      this.reliableMessages = [];
    }
    return out;
  }

  hasPendingReliable(): boolean {
    return this.reliableMessages.length > 0
        || hasAnyPatches(this.reliableComponents);
  }

  hasPendingUnreliable(): boolean {
    return hasAnyPatches(this.unreliableComponents);
  }
}

function drainEligible(
  buffer:  ChannelBuffer,
  policy:  ReplicatorPolicy,
  ctx:     FlushContext,
): ComponentPatch[] {
  const out: ComponentPatch[] = [];
  for (const [typeId, byEntity] of buffer.byType) {
    if (!policy.shouldFlush(typeId, ctx)) continue;
    for (const patch of byEntity.values()) out.push(patch);
    byEntity.clear();
  }
  return out;
}

function hasAnyPatches(buffer: ChannelBuffer): boolean {
  for (const byEntity of buffer.byType.values()) {
    if (byEntity.size > 0) return true;
  }
  return false;
}
