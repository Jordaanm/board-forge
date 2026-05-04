// EntityHandle implementation — issues #1 and #3 of issues--arch.md.
//
// Symmetric facade over an Entity. Read methods are pure entity reads;
// mutation verbs delegate to the owning WorldImpl, which dispatches the
// host- vs guest-specific implementation. Routing through World keeps
// transport, holdService, and identity concerns out of the handle itself.

import * as THREE from 'three';
import { type Entity } from '../Entity';
import { type EntityComponent, type ComponentClass } from '../EntityComponent';
import { type SeatIndex } from '../../seats/SeatLayout';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { canManipulate } from '../../seats/OwnershipPolicy';
import { type EntityHandle } from './types';

// Internal port — implemented by WorldImpl. Kept as an interface so the
// handle has no static cycle with World.ts.
export interface HandleRouter {
  isHost(): boolean;
  selfSeat(): SeatIndex | null;
  setPosition(entity: Entity, x: number, y: number, z: number): void;
  tryHold(entity: Entity, seat: SeatIndex): boolean;
  release(entity: Entity, velocity?: { vx: number; vy: number; vz: number }): void;
  applyImpulse(entity: Entity, v: { x: number; y: number; z: number }): void;
}

export class EntityHandleImpl implements EntityHandle {
  constructor(
    public readonly entity: Entity,
    private readonly router: HandleRouter,
  ) {}

  get id(): string { return this.entity.id; }

  position(): THREE.Vector3 {
    const t = this.entity.getComponent(TransformComponent);
    if (!t) return new THREE.Vector3();
    const [x, y, z] = t.state.position;
    return new THREE.Vector3(x, y, z);
  }

  velocity(): THREE.Vector3 {
    const p = this.entity.getComponent(PhysicsComponent);
    if (!p?.body) return new THREE.Vector3();
    const v = p.getVelocity();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  heldBy(): SeatIndex | null {
    return this.entity.heldBy;
  }

  get<T extends EntityComponent<any>>(cls: ComponentClass<T>): T | undefined {
    return this.entity.getComponent(cls);
  }

  setPosition(x: number, y: number, z: number): void {
    this.router.setPosition(this.entity, x, y, z);
  }

  canStartDrag(): boolean {
    return canManipulate(
      { peerSeat: this.router.selfSeat(), isHost: this.router.isHost() },
      this.entity.owner,
    );
  }

  tryHold(seat: SeatIndex): boolean {
    return this.router.tryHold(this.entity, seat);
  }

  release(velocity?: { vx: number; vy: number; vz: number }): void {
    this.router.release(this.entity, velocity);
  }

  applyImpulse(v: { x: number; y: number; z: number }): void {
    this.router.applyImpulse(this.entity, v);
  }
}
