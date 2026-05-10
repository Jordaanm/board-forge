// Generic 3D-volume primitive. Tracks which entities physically overlap a box
// volume via a Cannon kinematic sensor body. Replicates `containedIds` so
// guests can mirror membership without running physics.
//
// Issue #1 of planning/issues--hand.md (Zone primitive end-to-end). Composes
// with TweenComponent into HandComponent in issue #3; future PlayArea /
// DiscardPile / DealZone consumers reuse it without modification.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  EntityComponent,
  type SpawnContext,
  type EntityScene,
} from '../EntityComponent';
import { type PropertyDef } from '../propertySchema';
import { type Entity } from '../Entity';
import { TransformComponent } from './TransformComponent';
import { PhysicsComponent } from './PhysicsComponent';

export interface ZoneState {
  halfExtents:       [number, number, number];
  acceptTags?:       string[];
  acceptComponents?: string[];
  containedIds:      string[];
  isVisible:         boolean;
}

type ZoneCallback = (entity: Entity) => void;

interface ContactEvent {
  bodyA: CANNON.Body;
  bodyB: CANNON.Body;
}

export class ZoneComponent extends EntityComponent<ZoneState> {
  static typeId   = 'zone';
  static label    = 'Zone';
  static requires = ['transform'] as const;
  // halfExtents stays as a Vec3 in state (load-bearing for the physics body
  // shape). Each axis is exposed via a small adapter so the editor surfaces
  // three independent rows over the packed triple.
  static propertySchema: readonly PropertyDef<ZoneState>[] = [
    {
      key:   'halfExtentsX',
      label: 'Half-extent X',
      type:  'number',
      get:   (s) => s.halfExtents[0],
      set:   (v, s) => ({
        halfExtents: [Number(v), s.halfExtents[1], s.halfExtents[2]] as [number, number, number],
      }),
    },
    {
      key:   'halfExtentsY',
      label: 'Half-extent Y',
      type:  'number',
      get:   (s) => s.halfExtents[1],
      set:   (v, s) => ({
        halfExtents: [s.halfExtents[0], Number(v), s.halfExtents[2]] as [number, number, number],
      }),
    },
    {
      key:   'halfExtentsZ',
      label: 'Half-extent Z',
      type:  'number',
      get:   (s) => s.halfExtents[2],
      set:   (v, s) => ({
        halfExtents: [s.halfExtents[0], s.halfExtents[1], Number(v)] as [number, number, number],
      }),
    },
    { key: 'isVisible', label: 'Show debug box', type: 'boolean' },
  ];

  // Process-global UI flags read by updateDebugVisibility(). The canvas writes
  // to these from the editor surface (Show All Zones toggle, selected entity).
  static showAllZones:     boolean       = false;
  static selectedEntityId: string | null = null;

  body!: CANNON.Body;

  private debugMesh:    THREE.Mesh | null = null;
  private entityScene:  EntityScene | null = null;
  private physicsWorld: CANNON.World | null = null;

  // Raw overlap (every body whose narrowphase contact equation references the
  // sensor body). Held-state is layered on top in passesFilter.
  private overlappingBodies = new Set<CANNON.Body>();

  private enterHandlers: ZoneCallback[] = [];
  private exitHandlers:  ZoneCallback[] = [];

  // Snapshot so onPropertiesChanged can diff state.containedIds. Both host and
  // guest fire enter/exit through the diff — the host's contact handler just
  // computes the new array; the diff in onPropertiesChanged fans out events.
  private lastContainedSet = new Set<string>();

  private beginContactHandler: ((e: ContactEvent) => void) | null = null;
  private endContactHandler:   ((e: ContactEvent) => void) | null = null;

  onSpawn(ctx: SpawnContext): void {
    this.entityScene = ctx.entityScene;
    this.body        = buildSensorBody(this.state.halfExtents);
    this.syncBodyFromTransform();

    if (ctx.physics) {
      this.physicsWorld = ctx.physics.world;
      this.physicsWorld.addBody(this.body);
      this.beginContactHandler = (e) => this.handleBeginContact(e);
      this.endContactHandler   = (e) => this.handleEndContact(e);
      this.physicsWorld.addEventListener('beginContact', this.beginContactHandler);
      this.physicsWorld.addEventListener('endContact',   this.endContactHandler);
    }

    this.lastContainedSet = new Set(this.state.containedIds);
    this.buildDebugMesh();
    this.updateDebugVisibility();
  }

  onDespawn(_ctx: SpawnContext): void {
    if (this.physicsWorld) {
      if (this.beginContactHandler) this.physicsWorld.removeEventListener('beginContact', this.beginContactHandler);
      if (this.endContactHandler)   this.physicsWorld.removeEventListener('endContact',   this.endContactHandler);
      this.physicsWorld.removeBody(this.body);
      this.physicsWorld = null;
    }
    this.disposeDebugMesh();
    this.enterHandlers = [];
    this.exitHandlers  = [];
    this.overlappingBodies.clear();
  }

  onPropertiesChanged(changed: Partial<ZoneState>): void {
    if (changed.halfExtents !== undefined) {
      this.rebuildBodyShape();
      this.rebuildDebugMesh();
    }
    if (changed.isVisible !== undefined) {
      this.updateDebugVisibility();
    }
    if (changed.containedIds !== undefined) {
      this.fireDiff();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────
  subscribeEnter(cb: ZoneCallback): () => void {
    this.enterHandlers.push(cb);
    return () => { this.enterHandlers = this.enterHandlers.filter(h => h !== cb); };
  }

  subscribeExit(cb: ZoneCallback): () => void {
    this.exitHandlers.push(cb);
    return () => { this.exitHandlers = this.exitHandlers.filter(h => h !== cb); };
  }

  getContainedEntities(): Entity[] {
    if (!this.entityScene) return [];
    const out: Entity[] = [];
    for (const id of this.state.containedIds) {
      const e = this.entityScene.getEntity(id);
      if (e) out.push(e);
    }
    return out;
  }

  getOverlappingEntities(): Entity[] {
    if (!this.entityScene) return [];
    const out: Entity[] = [];
    for (const body of this.overlappingBodies) {
      const e = findEntityByPhysicsBody(this.entityScene, body);
      if (e) out.push(e);
    }
    return out;
  }

  // Called by World.tick (host only) before physics.step so contact detection
  // sees the up-to-date pose. Cheap — just copies seven scalars per zone.
  syncBodyFromTransform(): void {
    const t = this.entity.getComponent(TransformComponent);
    if (!t) return;
    const [px, py, pz]     = t.state.position;
    const [qx, qy, qz, qw] = t.state.rotation;
    this.body.position.set(px, py, pz);
    this.body.quaternion.set(qx, qy, qz, qw);
  }

  // Called per frame by the canvas. Three OR-conditions: state.isVisible,
  // global Show-All-Zones toggle, this entity is the editor's current
  // selection. Cheap enough to call unconditionally.
  updateDebugVisibility(): void {
    if (!this.debugMesh) return;
    this.debugMesh.visible =
         this.state.isVisible
      || ZoneComponent.showAllZones
      || ZoneComponent.selectedEntityId === this.entity.id;
  }

  // Host-only. Recomputes membership against the current overlap set, applying
  // the filter (acceptTags / acceptComponents / heldBy). Called by HoldService
  // after a release so an entity that landed in the zone while held joins now
  // that it's free.
  recomputeMembership(): void {
    if (!this.entityScene) return;
    const ids: string[] = [];
    for (const body of this.overlappingBodies) {
      const e = findEntityByPhysicsBody(this.entityScene, body);
      if (!e) continue;
      if (!this.passesFilter(e)) continue;
      ids.push(e.id);
    }
    if (sameOrder(ids, this.state.containedIds)) return;
    this.setState({ containedIds: ids });
  }

  // ── Contact handlers ──────────────────────────────────────────────────
  private handleBeginContact(event: ContactEvent): void {
    const other = otherBody(event, this.body);
    if (!other) return;
    this.overlappingBodies.add(other);
    this.maybeAddToContained(other);
  }

  private handleEndContact(event: ContactEvent): void {
    const other = otherBody(event, this.body);
    if (!other) return;
    this.overlappingBodies.delete(other);
    this.maybeRemoveFromContained(other);
  }

  private maybeAddToContained(other: CANNON.Body): void {
    if (!this.entityScene) return;
    const e = findEntityByPhysicsBody(this.entityScene, other);
    if (!e) return;
    if (!this.passesFilter(e)) return;
    if (this.state.containedIds.includes(e.id)) return;
    this.setState({ containedIds: [...this.state.containedIds, e.id] });
  }

  private maybeRemoveFromContained(other: CANNON.Body): void {
    if (!this.entityScene) return;
    const e = findEntityByPhysicsBody(this.entityScene, other);
    if (!e) return;
    if (!this.state.containedIds.includes(e.id)) return;
    this.setState({ containedIds: this.state.containedIds.filter(id => id !== e.id) });
  }

  private passesFilter(e: Entity): boolean {
    if (e.heldBy !== null) return false;
    const tags = this.state.acceptTags;
    if (tags && tags.length > 0 && !tags.some(t => e.tags.includes(t))) return false;
    const comps = this.state.acceptComponents;
    if (comps && comps.length > 0 && !comps.some(c => e.components.has(c))) return false;
    return true;
  }

  // ── Debug visual ──────────────────────────────────────────────────────
  private buildDebugMesh(): void {
    const t = this.entity.getComponent(TransformComponent);
    if (!t) return;
    const [hx, hy, hz] = this.state.halfExtents;
    const geom = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mat  = new THREE.MeshBasicMaterial({
      color:       0x44aaff,
      transparent: true,
      opacity:     0.18,
      depthWrite:  false,
    });
    this.debugMesh = new THREE.Mesh(geom, mat);
    this.debugMesh.userData.skipTint = true;
    // Three's raycaster doesn't auto-skip invisible objects, so override:
    // only pick the zone when its debug mesh is actually visible. Otherwise
    // clicks would land on a hidden box and miss entities inside.
    const defaultRaycast = THREE.Mesh.prototype.raycast;
    this.debugMesh.raycast = function (raycaster, intersects) {
      if (!this.visible) return;
      defaultRaycast.call(this, raycaster, intersects);
    };
    t.object3d.add(this.debugMesh);
  }

  private rebuildDebugMesh(): void {
    if (!this.debugMesh) return;
    this.debugMesh.geometry.dispose();
    const [hx, hy, hz] = this.state.halfExtents;
    this.debugMesh.geometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  }

  private disposeDebugMesh(): void {
    if (!this.debugMesh) return;
    this.debugMesh.parent?.remove(this.debugMesh);
    this.debugMesh.geometry.dispose();
    (this.debugMesh.material as THREE.Material).dispose();
    this.debugMesh = null;
  }

  private rebuildBodyShape(): void {
    if (!this.body) return;
    while (this.body.shapes.length) this.body.removeShape(this.body.shapes[0]);
    const [hx, hy, hz] = this.state.halfExtents;
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    this.body.updateBoundingRadius();
    this.body.aabbNeedsUpdate = true;
  }

  private fireDiff(): void {
    const next = new Set(this.state.containedIds);
    const prev = this.lastContainedSet;
    for (const id of next) {
      if (prev.has(id)) continue;
      const e = this.entityScene?.getEntity(id);
      if (e) for (const cb of this.enterHandlers) cb(e);
    }
    for (const id of prev) {
      if (next.has(id)) continue;
      const e = this.entityScene?.getEntity(id);
      if (e) for (const cb of this.exitHandlers) cb(e);
    }
    this.lastContainedSet = next;
  }
}

function buildSensorBody(halfExtents: [number, number, number]): CANNON.Body {
  const [hx, hy, hz] = halfExtents;
  const body = new CANNON.Body({
    mass:              0,
    type:              CANNON.Body.KINEMATIC,
    shape:             new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
    collisionResponse: false,
  });
  body.isTrigger = true;
  return body;
}

function otherBody(event: ContactEvent, self: CANNON.Body): CANNON.Body | null {
  if (event.bodyA === self) return event.bodyB;
  if (event.bodyB === self) return event.bodyA;
  return null;
}

function findEntityByPhysicsBody(scene: EntityScene, body: CANNON.Body): Entity | undefined {
  for (const e of scene.all()) {
    const phys = e.getComponent(PhysicsComponent);
    if (phys?.body === body) return e;
  }
  return undefined;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
