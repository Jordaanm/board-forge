// Single-call composition for the "one clickable element on a 3D object"
// case (issue #9 of issues--ui-surface.md). Produces a child surface entity
// (prim:plane mesh + SurfaceComponent) plus one element entity (Shape /
// Image / Rich) parented to that surface, positioned on the requested face
// of the parent's mesh.
//
// V1 uses manual face math against the parent's `MeshComponent.halfExtents`
// — the deferred `FaceAttachComponent` would compute this dynamically, but
// the manual approach is enough for the script-author UX described in the
// PRD. Surface is positioned in the parent's local frame and oriented so
// its +Z normal points outward from the requested face.

import * as THREE from 'three';
import { Entity } from '../Entity';
import { type SceneImpl } from '../Scene';
import { type SpawnContext } from '../EntityComponent';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';
import { SurfaceComponent } from './SurfaceComponent';
import { ShapeElement, type ShapeKind } from './ShapeElement';
import { ImageElement, type ImageFit } from './ImageElement';
import { RichElement } from './RichElement';

export type StickerFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface ShapeContent {
  shape: {
    kind:         ShapeKind;
    fill?:        string;
    stroke?:      string;
    strokeWidth?: number;
    radius?:      number;
  };
}

export interface ImageContent {
  image: string;
  fit?:  ImageFit;
}

export interface RichContent {
  html: string;
}

export type StickerContent = ShapeContent | ImageContent | RichContent;

export interface StickerOpts {
  face:        StickerFace;
  // World-space size of the surface plane: [width, height]. Defaults to a
  // unit square — authors typically scale to the parent's face dimensions.
  size?:       [number, number];
  // Off-surface offset from the face plane. Default ε so the sticker doesn't
  // z-fight with the parent face geometry.
  offset?:     number;
  // Pixel size of the offscreen canvas backing the surface. Defaults
  // [512, 512]; authors bump for crispness on physically-larger surfaces.
  canvasSize?: [number, number];
  // Element content. Exactly one of `shape | image | html` must be present.
  content:     StickerContent;
}

const DEFAULT_OFFSET = 0.001;

export interface AttachStickerResult {
  surface: Entity;
  element: Entity;
}

// Creates the surface + element entity tree under `parent`, runs onSpawn for
// each, and registers them in `scene`. Returns both for inspection — callers
// surface only the element to scripts (the element is what scripts attach
// listeners to).
export function attachSticker(
  scene:  SceneImpl,
  ctx:    SpawnContext,
  parent: Entity,
  opts:   StickerOpts,
): AttachStickerResult {
  const parentMesh = parent.getComponent(MeshComponent);
  if (!parentMesh) {
    throw new Error(`attachSticker: parent ${parent.id} has no MeshComponent`);
  }

  const halfExtents = parentMesh.halfExtents();
  const offset      = opts.offset ?? DEFAULT_OFFSET;
  const canvasSize  = opts.canvasSize ?? [512, 512];
  const size        = opts.size ?? [1, 1];
  const { position, rotation } = faceTransform(opts.face, halfExtents, offset);

  const surfaceId = newId();
  const surfaceEntity = new Entity({
    id:       surfaceId,
    type:     'sticker-surface',
    name:     `${parent.name}/sticker`,
    parentId: parent.id,
  });
  const transform = new TransformComponent();
  transform.fromJSON({ position, rotation, scale: [1, 1, 1] });
  surfaceEntity.attachComponent(transform);
  const mesh = new MeshComponent();
  mesh.fromJSON({
    meshRef:     'prim:plane',
    textureRefs: { default: '' },
    tint:        '#ffffff',
    size:        [size[0], 0, size[1]],
  });
  surfaceEntity.attachComponent(mesh);
  const surface = new SurfaceComponent();
  surface.fromJSON({ canvasSize });
  surfaceEntity.attachComponent(surface);
  parent.children.push(surfaceId);
  scene.add(surfaceEntity);
  transform.onSpawn(ctx);
  mesh.onSpawn(ctx);
  surface.onSpawn(ctx);

  const elementId = newId();
  const elementEntity = new Entity({
    id:       elementId,
    type:     elementTypeFor(opts.content),
    name:     `${surfaceEntity.name}/element`,
    parentId: surfaceId,
  });
  const elementComp = createElementComponent(opts.content, canvasSize);
  elementEntity.attachComponent(elementComp);
  surfaceEntity.children.push(elementId);
  scene.add(elementEntity);
  elementComp.onSpawn(ctx);

  return { surface: surfaceEntity, element: elementEntity };
}

function elementTypeFor(content: StickerContent): string {
  if ('html'  in content) return 'rich-element';
  if ('image' in content) return 'image-element';
  return 'shape-element';
}

function createElementComponent(
  content: StickerContent,
  canvasSize: [number, number],
): ShapeElement | ImageElement | RichElement {
  const [w, h] = canvasSize;
  if ('html' in content) {
    const c = new RichElement();
    c.fromJSON({ x: 0, y: 0, w, h, html: content.html });
    return c;
  }
  if ('image' in content) {
    const c = new ImageElement();
    c.fromJSON({ x: 0, y: 0, w, h, textureRef: content.image, fit: content.fit ?? 'fit' });
    return c;
  }
  const c = new ShapeElement();
  c.fromJSON({ x: 0, y: 0, w, h, ...content.shape });
  return c;
}

// Maps a face to (position offset from parent center, quaternion that
// rotates +Z to the face's outward normal). Result is in the parent's local
// coordinate frame; the surface entity carries this transform directly so
// no nested-transform math is needed at render time.
function faceTransform(
  face: StickerFace,
  halfExtents: [number, number, number],
  offset: number,
): { position: [number, number, number]; rotation: [number, number, number, number] } {
  const [hx, hy, hz] = halfExtents;
  const q = new THREE.Quaternion();
  let position: [number, number, number];
  switch (face) {
    case 'top':
      position = [0, hy + offset, 0];
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      break;
    case 'bottom':
      position = [0, -hy - offset, 0];
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      break;
    case 'front':
      position = [0, 0, hz + offset];
      // identity — plane already faces +Z.
      break;
    case 'back':
      position = [0, 0, -hz - offset];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      break;
    case 'left':
      position = [-hx - offset, 0, 0];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
      break;
    case 'right':
      position = [hx + offset, 0, 0];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      break;
  }
  return {
    position,
    rotation: [q.x, q.y, q.z, q.w],
  };
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
