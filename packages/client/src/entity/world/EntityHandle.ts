// EntityHandle implementation — issue #1 of issues--arch.md.
//
// Read-surface facade over an Entity. Mutation verbs land in issue #3.

import * as THREE from 'three';
import { type Entity } from '../Entity';
import { type EntityComponent, type ComponentClass } from '../EntityComponent';
import { type SeatIndex } from '../../seats/SeatLayout';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { type EntityHandle } from './types';

export class EntityHandleImpl implements EntityHandle {
  constructor(public readonly entity: Entity) {}

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
}
