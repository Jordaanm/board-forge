// Entity is the unit of identity in the new scene graph (slice #1 of
// planning/issues/issues--scene-graph.md). Pure data + a `components` map.
// View artefacts (THREE meshes, CANNON bodies) live on components, not here.

import { type SeatIndex } from '../seats/SeatLayout';
import { type EntityComponent, type ComponentClass } from './EntityComponent';
import { type SceneImpl } from './Scene';
import { EntityEventBus, type Listener } from './EntityEventBus';

export interface EntityInit {
  id:             string;
  type:           string;
  name:           string;
  tags?:          readonly string[];
  owner?:         SeatIndex | null;
  privateToSeat?: SeatIndex | null;
  parentId?:      string | null;
  children?:      readonly string[];
  isContained?:   boolean;
  customData?:    Readonly<Record<string, string>>;
}

export class Entity {
  id:            string;
  type:          string;
  name:          string;
  tags:          string[];
  owner:         SeatIndex | null;
  privateToSeat: SeatIndex | null;
  parentId:      string | null;
  children:      string[];
  // Generic "this entity is hidden inside a container" flag (issue #1 of
  // issues--deck.md). MeshComponent toggles `group.visible`; PhysicsComponent
  // adds/removes its body from the world. Replicated via entity-patch.
  isContained:   boolean;
  // Per-entity string map for script-authored persistent state (issue #6 of
  // issues--scripting-v1.md). Routed through `EntityFacade.setData/getData/
  // deleteData`; mutations enqueue a full-map `entity-patch` so guests
  // overwrite. Save-format leaf is a plain object.
  customData:    Map<string, string>;
  components:    Map<string, EntityComponent<any>>;
  // Transient — not serialised.
  heldBy:        SeatIndex | null;
  // Back-reference to the owning Scene. Set by SceneImpl.add and cleared on
  // despawn. attachComponent uses it to inject the World's replicator into
  // newly-attached components without a separate wire-up pass.
  scene:         SceneImpl | null;
  // Per-entity event bus. Scripts subscribe via EntityFacade; components
  // dispatch domain events through here. See `dispatchEvent`.
  private readonly bus = new EntityEventBus();

  constructor(init: EntityInit) {
    this.id            = init.id;
    this.type          = init.type;
    this.name          = init.name;
    this.tags          = init.tags          ? [...init.tags]     : [];
    this.owner         = init.owner         ?? null;
    this.privateToSeat = init.privateToSeat ?? null;
    this.parentId      = init.parentId      ?? null;
    this.children      = init.children      ? [...init.children] : [];
    this.isContained   = init.isContained   ?? false;
    this.customData    = new Map(init.customData ? Object.entries(init.customData) : []);
    this.components    = new Map();
    this.heldBy        = null;
    this.scene         = null;
  }

  getComponent<T extends EntityComponent<any>>(cls: ComponentClass<T>): T | undefined {
    return this.components.get(cls.typeId) as T | undefined;
  }

  hasComponent(cls: ComponentClass): boolean {
    return this.components.has(cls.typeId);
  }

  attachComponent(comp: EntityComponent<any>): void {
    const ctor = comp.constructor as ComponentClass;
    if (!ctor.typeId) throw new Error('Component class missing static typeId');
    if (this.components.has(ctor.typeId)) {
      throw new Error(`Entity ${this.id} already has component ${ctor.typeId}`);
    }
    this.components.set(ctor.typeId, comp);
    comp.entity = this;
    // If the entity is already in a scene with a host World, the new component
    // joins replication immediately. Pre-add attaches (the spawn / load path)
    // get their world reference filled in by SceneImpl.add.
    if (this.scene) comp.world = this.scene.world;
  }

  // Cancel any active tween on this entity. No-op if no TweenComponent is
  // attached. Duck-typed to avoid a static dependency on TweenComponent so
  // Entity stays a pure data class.
  cancelTween(): void {
    const tween = this.components.get('tween') as { cancel?: () => void } | undefined;
    tween?.cancel?.();
  }

  // Domain-event surface (issue #5 of issues--scripting-v1.md). Components
  // call `dispatchEvent` from their setState path; scripts subscribe via
  // `addEventListener` (routed through EntityFacade for teardown tracking).
  addEventListener(event: string, cb: Listener): void {
    this.bus.addListener(event, cb);
  }

  removeEventListener(event: string, cb: Listener): void {
    this.bus.removeListener(event, cb);
  }

  dispatchEvent<T = unknown>(event: string, payload: T): void {
    this.bus.dispatch(event, payload);
  }

  // customData mutators (issue #6 of issues--scripting-v1.md). Each
  // mutation enqueues a full-map `entity-patch` so guests overwrite their
  // local Map. Per-key delta is deferred. No-op enqueue if the entity isn't
  // yet attached to a host scene (constructor-time mutations during
  // SpawnableDef apply later in the spawn flow).
  setCustomData(key: string, value: string): void {
    this.customData.set(key, value);
    this.replicateCustomData();
  }

  getCustomData(key: string): string | undefined {
    return this.customData.get(key);
  }

  deleteCustomData(key: string): boolean {
    const had = this.customData.delete(key);
    if (had) this.replicateCustomData();
    return had;
  }

  private replicateCustomData(): void {
    const replicator = this.scene?.world ?? null;
    if (!replicator) return;
    replicator.enqueueEntityPatch(this.id, {
      customData: Object.fromEntries(this.customData),
    });
  }
}

// Default display name: `${label}-${guid.slice(0, 8)}`.
// Round-trips through save/load and host migration without a side-channel counter.
export function defaultEntityName(label: string, guid: string): string {
  return `${label}-${guid.slice(0, 8)}`;
}
