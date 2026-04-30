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
import { Scene } from './Scene';
import { type Entity } from './Entity';
import { type SeatIndex } from '../seats/SeatLayout';
import { type HostReplicatorV2 } from './HostReplicatorV2';
import { PhysicsComponent } from './components/PhysicsComponent';

export interface ReleaseVelocity {
  vx: number;
  vy: number;
  vz: number;
}

export class HoldService {
  // Cache the body's pre-claim type so we restore it (DYNAMIC/STATIC) on release.
  private priorBodyType = new Map<string, CANNON.BodyType>();

  constructor(private readonly replicator: HostReplicatorV2) {}

  // First-claimer-wins. Returns false if the entity is already held — the
  // host drops the claim silently and the guest's optimistic drag UI times
  // out / unwinds locally.
  tryClaim(entity: Entity, seat: SeatIndex): boolean {
    if (entity.heldBy !== null) return false;
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
  }

  // Peer disconnect: drop every hold owned by the leaving seat. No final
  // velocity — the body is dropped where it sits.
  releaseAllForSeat(seat: SeatIndex): void {
    for (const entity of Scene.all()) {
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
