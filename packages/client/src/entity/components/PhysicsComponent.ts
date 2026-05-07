// Rigid-body physics for an entity. Slice #3 of issues--scene-graph.md.
//
// Owns a CANNON.Body whose shape is derived from the sibling MeshComponent.
// Each physics tick the host calls syncFromBody() which writes the new pose
// back into the TransformComponent's state.

import * as CANNON from 'cannon-es';
import {
  EntityComponent,
  type SpawnContext,
  type CollisionEvent,
  type EntityScene,
  type MenuContext,
  type MenuItem,
  type ActionContext,
} from '../EntityComponent';
import { type Entity } from '../Entity';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';

export interface PhysicsState {
  mass:        number;
  friction:    number;
  restitution: number;
  isLocked:    boolean;
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
  private entityScene: EntityScene | null = null;
  // Saved on first lock, restored on unlock. Null while unlocked.
  private priorMass: number | null = null;
  // Cannon world reference used when this component's body is removed from the
  // world while the entity is contained. Held so onIsContainedChanged can
  // re-add the same body without rebuilding it.
  private physicsWorld: CANNON.World | null = null;
  private bodyInWorld = false;

  onSpawn(ctx: SpawnContext): void {
    const transform = this.entity.getComponent(TransformComponent)!;
    const mesh      = this.entity.getComponent(MeshComponent)!;
    this.body = buildBody(this.state, mesh);
    this.entityScene = ctx.entityScene;

    const [px, py, pz]     = transform.state.position;
    const [qx, qy, qz, qw] = transform.state.rotation;
    this.body.position.set(px, py, pz);
    this.body.quaternion.set(qx, qy, qz, qw);

    this.collideHandler = (e) => this.handleCollide(e.body);
    this.body.addEventListener('collide', this.collideHandler);

    if (ctx.physics) {
      this.physicsWorld = ctx.physics.world;
      if (!this.entity.isContained) {
        ctx.physics.addBody(this.body);
        this.bodyInWorld = true;
      }
    }

    if (this.state.isLocked) this.applyLockChange(true);
  }

  onDespawn(ctx: SpawnContext): void {
    if (this.collideHandler) {
      this.body.removeEventListener('collide', this.collideHandler);
      this.collideHandler = null;
    }
    if (ctx.physics && this.bodyInWorld) {
      ctx.physics.world.removeBody(this.body);
      this.bodyInWorld = false;
    }
    this.physicsWorld = null;
  }

  onIsContainedChanged(isContained: boolean): void {
    if (!this.body || !this.physicsWorld) return;
    if (isContained && this.bodyInWorld) {
      this.body.velocity.setZero();
      this.body.angularVelocity.setZero();
      this.physicsWorld.removeBody(this.body);
      this.bodyInWorld = false;
    } else if (!isContained && !this.bodyInWorld) {
      this.physicsWorld.addBody(this.body);
      this.bodyInWorld = true;
    }
  }

  onPropertiesChanged(changed: Partial<PhysicsState>): void {
    if (!this.body) return;
    // Mass first so a paired isLocked change captures or restores the new value.
    if (changed.mass !== undefined) {
      if (this.priorMass !== null) {
        this.priorMass = changed.mass;
      } else {
        this.body.mass = changed.mass;
        this.body.updateMassProperties();
      }
    }
    if (changed.friction    !== undefined && this.body.material)    this.body.material.friction    = changed.friction;
    if (changed.restitution !== undefined && this.body.material)    this.body.material.restitution = changed.restitution;
    if (changed.isLocked    !== undefined) this.applyLockChange(changed.isLocked);
  }

  private applyLockChange(locked: boolean): void {
    if (!this.body) return;
    if (locked && this.priorMass === null) {
      this.priorMass = this.body.mass;
      this.body.mass = 0;
      this.body.updateMassProperties();
      this.body.velocity.setZero();
      this.body.angularVelocity.setZero();
    } else if (!locked && this.priorMass !== null) {
      this.body.mass = this.priorMass;
      this.priorMass = null;
      this.body.updateMassProperties();
      this.body.wakeUp();
    }
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
  // Rebuild the body shape from the current sibling MeshComponent. Used when
  // sibling components (DeckComponent) resize the mesh and need the body's
  // hitbox to follow. Issue #2 of issues--deck.md.
  rebuildShape(): void {
    if (!this.body) return;
    const mesh = this.entity.getComponent(MeshComponent);
    if (!mesh) return;
    while (this.body.shapes.length > 0) this.body.removeShape(this.body.shapes[0]);
    this.body.addShape(buildShape(mesh));
    this.body.updateBoundingRadius();
    this.body.aabbNeedsUpdate = true;
    this.body.updateMassProperties();
  }

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
    if (this.state.isLocked) return;
    this.entity.cancelTween();
    this.body.applyImpulse(new CANNON.Vec3(i.x, i.y, i.z));
    this.body.wakeUp();
  }

  isAtRest(): boolean {
    return this.body.velocity.length() + this.body.angularVelocity.length() < REST_VEL_THRESHOLD;
  }

  // ── Context menu ───────────────────────────────────────────────────────
  // Lock toggle. Authority is enforced by dispatchMenuAction (host) and
  // HostInputDispatcher.handleInvokeAction (guest RPC) — both gate on
  // canManipulate, so the action body can flip state unconditionally.
  onContextMenu(_ctx: MenuContext): MenuItem[] {
    return [{
      kind:  'action',
      id:    'toggle-lock',
      label: this.state.isLocked ? 'Unlock movement' : 'Lock movement',
    }];
  }

  onAction(actionId: string, _args: object | undefined, _ctx: ActionContext): void {
    if (actionId === 'toggle-lock') {
      this.setState({ isLocked: !this.state.isLocked } as Partial<PhysicsState>);
    }
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
    const otherEntity = this.entityScene ? findEntityByBody(this.entityScene, otherBody) : undefined;
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
    case 'meeple':   return new CANNON.Cylinder(hx, hx, hy * 2, 12);
    case 'cylinder': return new CANNON.Cylinder(hx, hx, hy * 2, 64);
    case 'cube':
    case 'unknown':
    default:         return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
  }
}

// Linear scan; fine for PoC scale. A body→entity index is a future optimisation.
function findEntityByBody(scene: EntityScene, body: CANNON.Body): Entity | undefined {
  for (const e of scene.all()) {
    const phys = e.getComponent(PhysicsComponent);
    if (phys?.body === body) return e;
  }
  return undefined;
}
