// Rigid-body physics for an entity. Slice #3 of issues--scene-graph.md.
//
// Owns a CANNON.Body whose shape is derived from the sibling MeshComponent.
// Each physics tick the host calls syncFromBody() which writes the new pose
// back into the TransformComponent's state.

import * as CANNON from 'cannon-es';
import { EntityComponent, type SpawnContext, type CollisionEvent } from '../EntityComponent';
import { type Entity } from '../Entity';
import { Scene } from '../Scene';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';

export interface PhysicsState {
  mass:        number;
  friction:    number;
  restitution: number;
}

export interface Vec3Like { x: number; y: number; z: number }

const REST_VEL_THRESHOLD = 0.05;

export class PhysicsComponent extends EntityComponent<PhysicsState> {
  static typeId   = 'physics';
  static requires = ['transform', 'mesh'] as const;

  body!: CANNON.Body;

  private wasMoving = false;
  private startMovingHandlers: Array<() => void> = [];
  private stopMovingHandlers:  Array<() => void> = [];
  private collideHandler: ((e: { body: CANNON.Body; contact?: unknown }) => void) | null = null;

  onSpawn(ctx: SpawnContext): void {
    const transform = this.entity.getComponent(TransformComponent)!;
    const mesh      = this.entity.getComponent(MeshComponent)!;
    this.body = buildBody(this.state, mesh);

    const [px, py, pz]     = transform.state.position;
    const [qx, qy, qz, qw] = transform.state.rotation;
    this.body.position.set(px, py, pz);
    this.body.quaternion.set(qx, qy, qz, qw);

    this.collideHandler = (e) => this.handleCollide(e.body);
    this.body.addEventListener('collide', this.collideHandler);

    if (ctx.physics) ctx.physics.addBody(this.body);
  }

  onDespawn(ctx: SpawnContext): void {
    if (this.collideHandler) {
      this.body.removeEventListener('collide', this.collideHandler);
      this.collideHandler = null;
    }
    if (ctx.physics) ctx.physics.world.removeBody(this.body);
  }

  onPropertiesChanged(changed: Partial<PhysicsState>): void {
    if (!this.body) return;
    if (changed.mass        !== undefined) { this.body.mass        = changed.mass; this.body.updateMassProperties(); }
    if (changed.friction    !== undefined && this.body.material)    this.body.material.friction    = changed.friction;
    if (changed.restitution !== undefined && this.body.material)    this.body.material.restitution = changed.restitution;
  }

  // ── Per-tick host loop ──────────────────────────────────────────────────
  // Push CANNON's integrated pose into the TransformComponent. Also detects
  // start/stop-moving transitions and notifies subscribers.
  syncToTransform(): void {
    const transform = this.entity.getComponent(TransformComponent)!;
    const p = this.body.position;
    const q = this.body.quaternion;
    transform.setState({
      position: [p.x, p.y, p.z],
      rotation: [q.x, q.y, q.z, q.w],
      scale:    transform.state.scale,
    });

    const moving = !this.isAtRest();
    if (moving && !this.wasMoving) {
      for (const h of this.startMovingHandlers) h();
    } else if (!moving && this.wasMoving) {
      for (const h of this.stopMovingHandlers) h();
    }
    this.wasMoving = moving;
  }

  // ── Methods (PRD § Physics Component) ───────────────────────────────────
  getVelocity(): Vec3Like {
    const v = this.body.velocity;
    return { x: v.x, y: v.y, z: v.z };
  }

  setVelocity(v: Vec3Like): void {
    this.body.velocity.set(v.x, v.y, v.z);
    this.body.wakeUp();
  }

  applyForce(f: Vec3Like): void {
    this.body.applyForce(new CANNON.Vec3(f.x, f.y, f.z));
  }

  applyImpulse(i: Vec3Like): void {
    this.body.applyImpulse(new CANNON.Vec3(i.x, i.y, i.z));
    this.body.wakeUp();
  }

  isAtRest(): boolean {
    return this.body.velocity.length() + this.body.angularVelocity.length() < REST_VEL_THRESHOLD;
  }

  // ── Events ──────────────────────────────────────────────────────────────
  subscribeStartMoving(h: () => void): () => void {
    this.startMovingHandlers.push(h);
    return () => { this.startMovingHandlers = this.startMovingHandlers.filter(x => x !== h); };
  }

  subscribeStopMoving(h: () => void): () => void {
    this.stopMovingHandlers.push(h);
    return () => { this.stopMovingHandlers = this.stopMovingHandlers.filter(x => x !== h); };
  }

  private handleCollide(otherBody: CANNON.Body): void {
    const otherEntity = findEntityByBody(otherBody);
    const event: CollisionEvent = {};
    for (const comp of this.entity.components.values()) {
      comp.onCollision(otherEntity ?? this.entity, event);
    }
  }
}

function buildBody(state: PhysicsState, mesh: MeshComponent): CANNON.Body {
  const material = new CANNON.Material({ friction: state.friction, restitution: state.restitution });
  const shape    = buildShape(mesh);
  return new CANNON.Body({
    mass:           state.mass,
    shape,
    material,
    linearDamping:  0.3,
    angularDamping: 0.5,
  });
}

function buildShape(mesh: MeshComponent): CANNON.Shape {
  const [hx, hy, hz] = mesh.halfExtents();
  switch (mesh.meshKind()) {
    case 'meeple': return new CANNON.Cylinder(hx, hx, hy * 2, 12);
    case 'cube':
    case 'unknown':
    default:       return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
  }
}

// Linear scan; fine for PoC scale. Slice 5+ may add a body→entity index.
function findEntityByBody(body: CANNON.Body): Entity | undefined {
  for (const e of Scene.all()) {
    const phys = e.getComponent(PhysicsComponent);
    if (phys?.body === body) return e;
  }
  return undefined;
}
