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
import { DiceComponent } from './components/DiceComponent';
import { FlatViewComponent } from './components/FlatViewComponent';
import { CardComponent } from './components/CardComponent';
import { DeckComponent } from './components/DeckComponent';
import { ZoneComponent } from './components/ZoneComponent';
import { TweenComponent } from './components/TweenComponent';
import { HandComponent } from './components/HandComponent';
import { TableComponent } from './components/TableComponent';
import { SkydomeComponent } from './components/SkydomeComponent';
import { LightingComponent } from './components/LightingComponent';
import { SurfaceComponent } from './components/SurfaceComponent';
import { ShapeElement } from './components/ShapeElement';
import { ImageElement } from './components/ImageElement';
import { D6_FACE_MAP } from '../dice/d6';
import { D20_FACE_MAP } from '../dice/d20';

export function registerCorePrimitives(): void {
  if (!componentRegistry.has('transform')) componentRegistry.register(TransformComponent);
  if (!componentRegistry.has('mesh'))      componentRegistry.register(MeshComponent);
  if (!componentRegistry.has('physics'))   componentRegistry.register(PhysicsComponent);
  if (!componentRegistry.has('value'))     componentRegistry.register(ValueComponent);
  if (!componentRegistry.has('dice'))      componentRegistry.register(DiceComponent);
  if (!componentRegistry.has('flatview'))  componentRegistry.register(FlatViewComponent);
  if (!componentRegistry.has('card'))      componentRegistry.register(CardComponent);
  if (!componentRegistry.has('deck'))      componentRegistry.register(DeckComponent);
  if (!componentRegistry.has('zone'))      componentRegistry.register(ZoneComponent);
  if (!componentRegistry.has('tween'))     componentRegistry.register(TweenComponent);
  if (!componentRegistry.has('hand'))      componentRegistry.register(HandComponent);
  if (!componentRegistry.has('table'))     componentRegistry.register(TableComponent);
  if (!componentRegistry.has('skydome'))   componentRegistry.register(SkydomeComponent);
  if (!componentRegistry.has('lighting'))  componentRegistry.register(LightingComponent);
  if (!componentRegistry.has('surface'))       componentRegistry.register(SurfaceComponent);
  if (!componentRegistry.has('shape-element')) componentRegistry.register(ShapeElement);
  if (!componentRegistry.has('image-element')) componentRegistry.register(ImageElement);

  if (!getSpawnable('table')) registerSpawnable({
    type:        'table',
    label:       'Table',
    category:    'Fixtures',
    defaultTags: ['table', 'fixture'],
    hidden:      true,
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:table-rect', textureRefs: { default: '' }, tint: '#4a3728', size: [12, 0.3, 8] } },
      { typeId: 'physics',   state: { mass: 0, friction: 0.5, restitution: 0.3, isLocked: true } },
      { typeId: 'table',     state: {} },
      { typeId: 'skydome',   state: { textureUrl: 'base:sky/default' } },
      { typeId: 'lighting',  state: { keyColor: '#fff1dc', keyIntensity: 1.1 } },
    ],
  });

  if (!getSpawnable('board')) registerSpawnable({
    type:        'board',
    label:       'Board',
    category:    'Boards',
    defaultTags: ['board'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:cube', textureRefs: { default: '' }, tint: '#2d5a27', size: [4, 0.05, 3] } },
      { typeId: 'physics',   state: { mass: 0.5, friction: 0.5, restitution: 0.3, isLocked: true } },
    ],
  });

  if (!getSpawnable('die')) registerSpawnable({
    type:        'die',
    label:       'Die (D6)',
    category:    'Dice',
    defaultTags: ['die'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:d6', textureRefs: { default: '' }, tint: '#fafafa', size: 0.7 } },
      { typeId: 'physics',   state: { mass: 0.2, friction: 0.5, restitution: 0.5, isLocked: false } },
      { typeId: 'value',     state: { value: '6', isNumeric: true } },
      { typeId: 'dice',      state: { maxValue: 6, faceMap: D6_FACE_MAP } },
      { typeId: 'tween',     state: {} },
    ],
  });

  if (!getSpawnable('d20')) registerSpawnable({
    type:        'd20',
    label:       'Die (D20)',
    category:    'Dice',
    defaultTags: ['die'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:d20', textureRefs: { default: '' }, tint: '#fafafa', size: 1.4 } },
      { typeId: 'physics',   state: { mass: 0.25, friction: 0.5, restitution: 0.5, isLocked: false } },
      { typeId: 'value',     state: { value: '20', isNumeric: true } },
      { typeId: 'dice',      state: { maxValue: 20, faceMap: D20_FACE_MAP } },
      { typeId: 'tween',     state: {} },
    ],
  });

  if (!getSpawnable('token')) registerSpawnable({
    type:        'token',
    label:       'Token',
    category:    'Tokens',
    defaultTags: ['token'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:meeple', textureRefs: { default: '' }, tint: '#2266cc', size: [0.5, 0.75, 0.5] } },
      { typeId: 'physics',   state: { mass: 0.1, friction: 0.5, restitution: 0.3, isLocked: false } },
      { typeId: 'tween',     state: {} },
    ],
  });

  if (!getSpawnable('card')) registerSpawnable({
    type:        'card',
    label:       'Card',
    category:    'Cards',
    defaultTags: ['card'],
    components: [
      { typeId: 'value',     state: { value: '', isNumeric: false } },
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:card', textureRefs: { face: '', back: '' }, tint: '#fafafa', size: [0.63, 0.01, 0.88] } },
      { typeId: 'physics',   state: { mass: 0.05, friction: 0.6, restitution: 0.1, isLocked: false } },
      { typeId: 'flatview',  state: { textureRef: '' } },
      { typeId: 'card',      state: { face: '', back: '', category: '' } },
      { typeId: 'tween',     state: {} },
    ],
  });

  if (!getSpawnable('deck')) registerSpawnable({
    type:        'deck',
    label:       'Deck',
    category:    'Cards',
    defaultTags: ['deck'],
    internal:    true,
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'mesh',      state: { meshRef: 'prim:deck', textureRefs: { face: '', back: '' }, tint: '#fafafa', size: [0.63, 0.02, 0.88] } },
      { typeId: 'physics',   state: { mass: 0.05, friction: 0.6, restitution: 0.1, isLocked: false } },
      { typeId: 'tween',     state: {} },
      { typeId: 'deck',      state: { cards: [], category: '' } },
    ],
  });

  if (!getSpawnable('zone')) registerSpawnable({
    type:        'zone',
    label:       'Zone',
    category:    'Zones',
    defaultTags: ['zone'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'zone',      state: { halfExtents: [0.5, 0.1, 0.5], containedIds: [], isVisible: true } },
    ],
  });

  if (!getSpawnable('hand')) registerSpawnable({
    type:        'hand',
    label:       'Hand',
    category:    'Zones',
    defaultTags: ['hand'],
    components: [
      { typeId: 'transform', state: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeId: 'zone',      state: {
          halfExtents:      [0.5, 0.1, 0.15],
          acceptComponents: ['flatview'],
          containedIds:     [],
          isVisible:        false,
        } },
      { typeId: 'hand',      state: { isMainHand: false, isPrivate: true } },
    ],
  });
}
