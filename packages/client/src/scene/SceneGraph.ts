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
}

export class SceneGraph {
  private entries = new Map<string, SceneEntry>();
  private nextId   = 0;

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

    const entry: SceneEntry = { id, objectType, mesh, body };
    this.entries.set(id, entry);
    return entry;
  }

  // Guest: create meshes for new object IDs arriving in state updates
  ensureObjects(states: ObjectState[], scene: THREE.Scene) {
    for (const s of states) {
      if (this.entries.has(s.id)) continue;
      const def  = OBJECT_TYPE_REGISTRY[s.objectType];
      const mesh = def.createMesh();
      mesh.position.set(s.px, s.py, s.pz);
      (mesh.quaternion as THREE.Quaternion).set(s.qx, s.qy, s.qz, s.qw);
      scene.add(mesh);
      this.entries.set(s.id, { id: s.id, objectType: s.objectType, mesh, body: null });
    }
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

  applyStates(states: ObjectState[]) {
    for (const s of states) {
      const e = this.entries.get(s.id);
      if (!e) continue;
      e.mesh.position.set(s.px, s.py, s.pz);
      e.mesh.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    }
  }
}
