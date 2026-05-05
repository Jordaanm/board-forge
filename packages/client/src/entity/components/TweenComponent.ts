// Generic motion primitive: smoothly move an entity to a target pose with
// ease-out cubic, suspending physics collisions during motion.
//
// Issue #2 of planning/issues--hand.md (Tween primitive end-to-end). Composes
// with ZoneComponent into HandComponent in issue #3; future scripted
// animations and dealt-card motion reuse it.
//
// No persistent serialised state — internals are transient. World.snapshot
// pre-walks active tweens and snap-to-target before serialising so the
// destination round-trips through save / load.

import * as THREE from 'three';
import { EntityComponent, type SpawnContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';

export interface TweenState {
  // Intentionally empty.
}

export interface TweenTarget {
  position: [number, number, number];
  rotation?: [number, number, number, number];
}

interface ActiveTween {
  startPosition:            [number, number, number];
  startRotation:            [number, number, number, number];
  targetPosition:           [number, number, number];
  targetRotation:           [number, number, number, number] | null;
  durationMs:               number;
  elapsedMs:                number;
  stashedMass:              number;
  stashedCollisionResponse: boolean;
}

const _qStart = new THREE.Quaternion();
const _qEnd   = new THREE.Quaternion();
const _qOut   = new THREE.Quaternion();

export class TweenComponent extends EntityComponent<TweenState> {
  static typeId   = 'tween';
  static requires = ['transform', 'physics'] as const;

  private tween: ActiveTween | null = null;

  onSpawn(_ctx: SpawnContext): void { /* no view, no body */ }

  onDespawn(_ctx: SpawnContext): void {
    if (this.tween) this.cancel();
  }

  onPropertiesChanged(): void { /* state is empty */ }

  isActive(): boolean {
    return this.tween !== null;
  }

  tweenTo(target: TweenTarget, durationMs: number, delayMs: number = 0): void {
    if (this.tween) this.cancel();

    const transform = this.entity.getComponent(TransformComponent);
    const physics   = this.entity.getComponent(PhysicsComponent);
    if (!transform || !physics) return;

    this.tween = {
      startPosition:            cloneVec3(transform.state.position),
      startRotation:            cloneQuat(transform.state.rotation),
      targetPosition:           cloneVec3(target.position),
      targetRotation:           target.rotation ? cloneQuat(target.rotation) : null,
      durationMs:               Math.max(0, durationMs),
      // Negative elapsed acts as a delay: tick accumulates without rendering
      // until elapsed >= 0. Used by deal staggering. Issue #9 of issues--deck.md.
      elapsedMs:                -Math.max(0, delayMs),
      stashedMass:              physics.body.mass,
      stashedCollisionResponse: physics.body.collisionResponse,
    };

    physics.body.mass              = 0;
    physics.body.collisionResponse = false;
    physics.body.updateMassProperties();
    physics.body.velocity.setZero();
    physics.body.angularVelocity.setZero();
  }

  cancel(): void {
    if (!this.tween) return;
    const physics = this.entity.getComponent(PhysicsComponent);
    if (physics) {
      physics.body.mass              = this.tween.stashedMass;
      physics.body.collisionResponse = this.tween.stashedCollisionResponse;
      physics.body.updateMassProperties();
      physics.body.wakeUp();
    }
    this.tween = null;
  }

  // Force the tween to its destination immediately. Mutates TransformComponent
  // and the physics body to the target pose, restores physics, clears state.
  // Called by World.snapshot for active tweens so save / load preserves the
  // destination.
  snapToTarget(): void {
    if (!this.tween) return;
    const transform = this.entity.getComponent(TransformComponent);
    const physics   = this.entity.getComponent(PhysicsComponent);
    if (!transform) { this.cancel(); return; }

    const tp = this.tween.targetPosition;
    const tr = this.tween.targetRotation ?? transform.state.rotation;
    transform.setState({
      position: cloneVec3(tp),
      rotation: cloneQuat(tr),
      scale:    transform.state.scale,
    });
    if (physics) {
      physics.body.position.set(tp[0], tp[1], tp[2]);
      if (this.tween.targetRotation) {
        physics.body.quaternion.set(tr[0], tr[1], tr[2], tr[3]);
      }
      physics.body.aabbNeedsUpdate = true;
    }
    this.cancel();
  }

  // Called per host tick by World. Advances elapsed time, writes interpolated
  // pose into the sibling TransformComponent and physics body. When the tween
  // completes, restores physics.
  tick(dtSeconds: number): void {
    if (!this.tween) return;
    this.tween.elapsedMs += dtSeconds * 1000;
    // Pre-delay phase: physics is already kinematicized, so the entity sits
    // frozen at startPosition until the delay elapses.
    if (this.tween.elapsedMs < 0) return;

    const linT = this.tween.durationMs > 0
      ? Math.min(1, this.tween.elapsedMs / this.tween.durationMs)
      : 1;
    const t    = easeOutCubic(linT);

    const transform = this.entity.getComponent(TransformComponent);
    const physics   = this.entity.getComponent(PhysicsComponent);
    if (!transform || !physics) return;

    const sp = this.tween.startPosition;
    const tp = this.tween.targetPosition;
    const px = sp[0] + (tp[0] - sp[0]) * t;
    const py = sp[1] + (tp[1] - sp[1]) * t;
    const pz = sp[2] + (tp[2] - sp[2]) * t;

    let rotation: [number, number, number, number];
    if (this.tween.targetRotation) {
      const [sx, sy, sz, sw] = this.tween.startRotation;
      const [ex, ey, ez, ew] = this.tween.targetRotation;
      _qStart.set(sx, sy, sz, sw);
      _qEnd.set(ex, ey, ez, ew);
      _qOut.copy(_qStart).slerp(_qEnd, t);
      rotation = [_qOut.x, _qOut.y, _qOut.z, _qOut.w];
    } else {
      rotation = transform.state.rotation;
    }

    transform.setState({
      position: [px, py, pz],
      rotation,
      scale:    transform.state.scale,
    });
    physics.body.position.set(px, py, pz);
    physics.body.aabbNeedsUpdate = true;
    if (this.tween.targetRotation) {
      physics.body.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
    }

    if (linT >= 1) this.cancel();
  }

  toJSON(): object {
    return {};
  }

  fromJSON(_o: object): void {
    this.state = {} as TweenState;
  }
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function cloneVec3(v: readonly [number, number, number]): [number, number, number] {
  return [v[0], v[1], v[2]];
}

function cloneQuat(q: readonly [number, number, number, number]): [number, number, number, number] {
  return [q[0], q[1], q[2], q[3]];
}
