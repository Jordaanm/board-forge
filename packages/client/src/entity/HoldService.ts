// Host-side hold lifecycle for entity drag.
// Slice #5 of planning/issues/issues--scene-graph.md.
//
// `entity.heldBy` is the per-seat lock. The host is the sole authority — it
// validates claims, sets / clears `heldBy`, toggles the physics body to
// kinematic during a hold, and broadcasts hold-claim / hold-release messages
// to all peers (including the claimer, so guests confirm acceptance).
//
// Host's own drags + inbound guest hold-claim messages both flow through
// `tryClaim` / `release`, so the policy lives in one place.

import * as CANNON from 'cannon-es';
import { type SceneImpl } from './Scene';
import { type Entity } from './Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { type HostReplicatorV2 } from './HostReplicatorV2';
import { type MergeService } from './MergeService';
import { PhysicsComponent } from './components/PhysicsComponent';
import { ZoneComponent } from './components/ZoneComponent';

export interface ReleaseVelocity {
  vx: number;
  vy: number;
  vz: number;
}

export class HoldService {
  // Cache the body's pre-claim type so we restore it (DYNAMIC/STATIC) on release.
  private priorBodyType = new Map<string, CANNON.BodyType>();
  private mergeService: MergeService | null = null;

  constructor(
    private readonly replicator: HostReplicatorV2,
    private readonly scene:      SceneImpl,
  ) {}

  // Optional injection — World wires this on host construction. HoldService
  // tests can omit it; the recheck path is a no-op when null.
  setMergeService(merge: MergeService): void {
    this.mergeService = merge;
  }

  // First-claimer-wins. Returns false if the entity is already held or its
  // PhysicsComponent is locked — the host drops the claim silently and the
  // guest's optimistic drag UI times out / unwinds locally.
  tryClaim(entity: Entity, seat: SeatIndex): boolean {
    if (entity.heldBy !== null) return false;
    const phys = entity.getComponent(PhysicsComponent);
    if (phys?.state.isLocked) return false;
    entity.cancelTween();
    entity.heldBy = seat;

    const body = entity.getComponent(PhysicsComponent)?.body;
    if (body) {
      this.priorBodyType.set(entity.id, body.type);
      body.type = CANNON.Body.KINEMATIC;
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    }

    this.replicator.enqueueHoldClaim({ entityId: entity.id, seat });
    return true;
  }

  release(entity: Entity, vel?: ReleaseVelocity): void {
    if (entity.heldBy === null) return;
    entity.heldBy = null;

    const body = entity.getComponent(PhysicsComponent)?.body;
    if (body) {
      const prior = this.priorBodyType.get(entity.id) ?? CANNON.Body.DYNAMIC;
      body.type = prior;
      this.priorBodyType.delete(entity.id);
      if (vel) body.velocity.set(vel.vx, vel.vy, vel.vz);
      else     body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    }

    this.replicator.enqueueHoldRelease(
      vel
        ? { entityId: entity.id, vx: vel.vx, vy: vel.vy, vz: vel.vz }
        : { entityId: entity.id },
    );

    // Held-state filter excludes carried entities from zone membership; on
    // release any zone whose AABB still overlaps the body must include it.
    for (const z of this.scene.all()) {
      const zone = z.getComponent(ZoneComponent);
      if (zone) zone.recomputeMembership();
    }

    // Merge recheck — issue #4 of issues--deck.md. A card released onto a deck
    // that was already in physical contact never re-fires beginContact, so we
    // poll the live contact set here.
    this.mergeService?.recheckMergeOverlaps(entity);
  }

  // Peer disconnect: drop every hold owned by the leaving seat. No final
  // velocity — the body is dropped where it sits.
  releaseAllForSeat(seat: SeatIndex): void {
    for (const entity of this.scene.all()) {
      if (entity.heldBy === seat) this.release(entity);
    }
  }

  // Zone-entry suppression placeholder (PRD-2 reads this when wiring zones).
  // An entity with `heldBy != null` is being carried; zones should ignore
  // overlap events for it until released.
  static suppressZoneEvents(entity: Entity): boolean {
    return entity.heldBy !== null;
  }
}
