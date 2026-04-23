import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { type SpawnableType, type ObjectState } from '../net/SceneState';
import { OBJECT_TYPE_REGISTRY } from './objectTypes';
import { type PhysicsWorld } from '../physics/PhysicsWorld';
import { TABLE_SURFACE_Y } from './Table';

export interface SceneEntry {
  id: string;
  objectType: SpawnableType;
  mesh: THREE.Object3D;
  body: CANNON.Body | null;
  props: Record<string, unknown>;
}

export class SceneGraph {
  private entries = new Map<string, SceneEntry>();
  private nextId   = 0;
  private listeners: Array<() => void> = [];

  // Subscribe to add/remove/prop-change events. Returns unsubscribe fn.
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify() { for (const l of this.listeners) l(); }

  // Host: spawn a new object with physics
  spawn(objectType: SpawnableType, scene: THREE.Scene, physics: PhysicsWorld): SceneEntry {
    const id  = `${objectType}-${this.nextId++}`;
    const def = OBJECT_TYPE_REGISTRY[objectType];
    const mesh = def.createMesh();
    const body = def.createBody();

    const x = (Math.random() - 0.5) * 6;
    const z = (Math.random() - 0.5) * 3;
    const y = TABLE_SURFACE_Y + def.spawnHeight + (def.isThrowable ? 0.5 : 0.02);

    mesh.position.set(x, y, z);
    if (body) {
      body.position.set(x, y, z);
      physics.addBody(body);
    }
    scene.add(mesh);

    const entry: SceneEntry = { id, objectType, mesh, body, props: { ...def.defaultProps } };
    this.entries.set(id, entry);
    this.notify();
    return entry;
  }

  // Guest: create meshes for new object IDs arriving in state updates
  ensureObjects(states: ObjectState[], scene: THREE.Scene) {
    let added = false;
    for (const s of states) {
      if (this.entries.has(s.id)) continue;
      const def  = OBJECT_TYPE_REGISTRY[s.objectType];
      const mesh = def.createMesh();
      mesh.position.set(s.px, s.py, s.pz);
      (mesh.quaternion as THREE.Quaternion).set(s.qx, s.qy, s.qz, s.qw);
      scene.add(mesh);
      this.entries.set(s.id, {
        id: s.id, objectType: s.objectType, mesh, body: null,
        props: { ...def.defaultProps },
      });
      added = true;
    }
    if (added) this.notify();
  }

  getAll():                       SceneEntry[]          { return [...this.entries.values()]; }
  getEntry(id: string):           SceneEntry | undefined { return this.entries.get(id); }

  // Walk up the THREE hierarchy to find which entry owns a hit object
  findEntry(hitObject: THREE.Object3D): SceneEntry | undefined {
    let obj: THREE.Object3D | null = hitObject;
    while (obj) {
      for (const entry of this.entries.values()) {
        if (entry.mesh === obj) return entry;
      }
      obj = obj.parent;
    }
    return undefined;
  }

  getPhysicsStates(): ObjectState[] {
    return this.getAll()
      .filter(e => e.body !== null)
      .map(e => ({
        id:         e.id,
        objectType: e.objectType,
        px: e.body!.position.x,    py: e.body!.position.y,    pz: e.body!.position.z,
        qx: e.body!.quaternion.x,  qy: e.body!.quaternion.y,
        qz: e.body!.quaternion.z,  qw: e.body!.quaternion.w,
      }));
  }

  syncFromPhysics() {
    for (const e of this.entries.values()) {
      if (!e.body) continue;
      e.mesh.position.set(e.body.position.x, e.body.position.y, e.body.position.z);
      e.mesh.quaternion.set(
        e.body.quaternion.x, e.body.quaternion.y,
        e.body.quaternion.z, e.body.quaternion.w,
      );
    }
  }

  remove(id: string, scene: THREE.Scene, physics: PhysicsWorld | null) {
    const entry = this.entries.get(id);
    if (!entry) return;
    scene.remove(entry.mesh);
    if (entry.body && physics) physics.world.removeBody(entry.body);
    this.entries.delete(id);
    this.notify();
  }

  applyStates(states: ObjectState[]) {
    for (const s of states) {
      const e = this.entries.get(s.id);
      if (!e) continue;
      e.mesh.position.set(s.px, s.py, s.pz);
      e.mesh.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    }
  }

  updateProp(id: string, key: string, value: unknown) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.props[key] = value;
    OBJECT_TYPE_REGISTRY[entry.objectType].applyProp(entry, key, value);
    this.notify();
  }

  // Bulk apply for guest receiving an update-props replication message
  applyProps(id: string, props: Record<string, unknown>) {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const [k, v] of Object.entries(props)) {
      entry.props[k] = v;
      OBJECT_TYPE_REGISTRY[entry.objectType].applyProp(entry, k, v);
    }
    this.notify();
  }
}
