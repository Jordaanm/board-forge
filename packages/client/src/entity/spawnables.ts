// Built-in spawnables for the v2 scene graph — board, die, token.
// Slice #3 of planning/issues/issues--scene-graph.md.
//
// Idempotent: registering twice is a no-op (slice #4 + tests rely on this).

import { componentRegistry } from './ComponentRegistry';
import { registerSpawnable, getSpawnable } from './SpawnableRegistry';
import { TransformComponent } from './components/TransformComponent';
import { MeshComponent } from './components/MeshComponent';
import { PhysicsComponent } from './components/PhysicsComponent';
import { ValueComponent } from './components/ValueComponent';

export function registerCorePrimitives(): void {
  if (!componentRegistry.has('transform')) componentRegistry.register(TransformComponent);
  if (!componentRegistry.has('mesh'))      componentRegistry.register(MeshComponent);
  if (!componentRegistry.has('physics'))   componentRegistry.register(PhysicsComponent);
  if (!componentRegistry.has('value'))     componentRegistry.register(ValueComponent);

  if (!getSpawnable('board')) registerSpawnable({
    type:        'board',
    label:       'Board',
    defaultTags: ['board'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:cube', textureRef: '', tint: '#2d5a27', size: [4, 0.05, 3] } },
      { typeId: 'physics',   state: { mass: 0.5, friction: 0.5, restitution: 0.3 } },
    ],
  });

  if (!getSpawnable('die')) registerSpawnable({
    type:        'die',
    label:       'Die (D6)',
    defaultTags: ['die'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:cube', textureRef: '', tint: '#fafafa', size: 0.7 } },
      { typeId: 'physics',   state: { mass: 0.2, friction: 0.5, restitution: 0.5 } },
      { typeId: 'value',     state: { value: '6', isNumeric: true } },
    ],
  });

  if (!getSpawnable('token')) registerSpawnable({
    type:        'token',
    label:       'Token',
    defaultTags: ['token'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:meeple', textureRef: '', tint: '#2266cc', size: [0.5, 0.75, 0.5] } },
      { typeId: 'physics',   state: { mass: 0.1, friction: 0.5, restitution: 0.3 } },
    ],
  });
}
