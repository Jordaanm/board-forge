// Entity is the unit of identity in the new scene graph (slice #1 of
// planning/issues/issues--scene-graph.md). Pure data + a `components` map.
// View artefacts (THREE meshes, CANNON bodies) live on components, not here.

import { type SeatIndex } from '../seats/SeatLayout';
import { type EntityComponent, type ComponentClass } from './EntityComponent';
import { type SceneImpl } from './Scene';

export interface EntityInit {
  id:             string;
  type:           string;
  name:           string;
  tags?:          readonly string[];
  owner?:         SeatIndex | null;
  privateToSeat?: SeatIndex | null;
  parentId?:      string | null;
  children?:      readonly string[];
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
  components:    Map<string, EntityComponent<any>>;
  // Transient — not serialised.
  heldBy:        SeatIndex | null;
  // Back-reference to the owning Scene. Set by SceneImpl.add and cleared on
  // despawn. attachComponent uses it to inject the World's replicator into
  // newly-attached components without a separate wire-up pass.
  scene:         SceneImpl | null;

  constructor(init: EntityInit) {
    this.id            = init.id;
    this.type          = init.type;
    this.name          = init.name;
    this.tags          = init.tags          ? [...init.tags]     : [];
    this.owner         = init.owner         ?? null;
    this.privateToSeat = init.privateToSeat ?? null;
    this.parentId      = init.parentId      ?? null;
    this.children      = init.children      ? [...init.children] : [];
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
}

// Default display name: `${label}-${guid.slice(0, 8)}`.
// Round-trips through save/load and host migration without a side-channel counter.
export function defaultEntityName(label: string, guid: string): string {
  return `${label}-${guid.slice(0, 8)}`;
}
