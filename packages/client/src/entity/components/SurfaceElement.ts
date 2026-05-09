// SurfaceElement is the data shape for a single element living inside a
// SurfaceComponent's `state.elements` array (issue #2 of issues--ui-surface-
// refactor.md). Replaces the per-element child-entity model: every surface
// element is now plain data on the surface, not a separate Entity.
//
// Discriminated union on `kind`:
//   - 'shape' — Canvas2D rect / circle, no asset deps
//   - 'image' — single asset ref + fit mode
//   - 'rich'  — HTML rendered through SatoriRenderer with `<img>` asset subs
//
// Bounds (`x, y, w, h`) are pixel coordinates inside the surface canvas.

export type SurfaceElementKind = 'shape' | 'image' | 'rich';

export type ShapeShape = 'rect' | 'circle';

export type ImageFit = 'fit' | 'cover' | 'stretch' | 'none';

export interface ElementBoundsBase {
  id: string;
  x:  number;
  y:  number;
  w:  number;
  h:  number;
}

export interface ShapeElement extends ElementBoundsBase {
  kind:         'shape';
  shape:        ShapeShape;
  fill?:        string;
  stroke?:      string;
  strokeWidth?: number;
  radius?:      number;
}

export interface ImageElement extends ElementBoundsBase {
  kind:       'image';
  textureRef: string;
  fit:        ImageFit;
}

export interface RichElement extends ElementBoundsBase {
  kind: 'rich';
  html: string;
}

export type SurfaceElement = ShapeElement | ImageElement | RichElement;

// `crypto.randomUUID()` with the same fallback the rest of the codebase uses.
// Element ids are GUIDs so they're stable across save/load and replication.
export function newElementId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Shorthand union the editor uses to dispatch new-element creation. Each form
// produces a `SurfaceElement` of the matching kind with default state. Shape-
// rect / shape-circle both produce `kind: 'shape'` elements; the discriminator
// difference is in the element's `shape` field.
export type EditorElementKind = 'rich' | 'image' | 'shape-rect' | 'shape-circle';

export function makeDefaultElement(kind: EditorElementKind, w: number, h: number): SurfaceElement {
  const id = newElementId();
  if (kind === 'rich') {
    return {
      id, kind: 'rich',
      x: 0, y: 0, w, h,
      html: '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:32px;color:#fff;background:#1e293b;">Rich Text</div>',
    };
  }
  if (kind === 'image') {
    return { id, kind: 'image', x: 0, y: 0, w, h, textureRef: '', fit: 'fit' };
  }
  return {
    id, kind: 'shape',
    x: 0, y: 0, w, h,
    shape: kind === 'shape-circle' ? 'circle' : 'rect',
    fill:  '#88c0ff',
  };
}
