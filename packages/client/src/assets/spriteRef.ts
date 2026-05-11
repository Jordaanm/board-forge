// Pure sprite-ref grammar. Single source of truth for the 3-segment ref form
// (`<namespace>:<body>:<index>`) used by the spritesheet asset type. No I/O,
// no THREE dependency. Consumed by AssetService, AssetPicker, Manifest.
//
// A 2-segment slug (`custom:deck`) addresses a sheet entry in the Manifest.
// A 3-segment ref (`custom:deck:5`) is *synthetic* — it identifies sprite N
// within that sheet and is never stored as its own Manifest entry.

import { ALLOWED_NAMESPACES, type Namespace } from './Manifest';

export type ParsedRef =
  | { kind: 'slug';   namespace: Namespace; body: string }
  | { kind: 'sprite'; sheetSlug: string;    index: number };

const NAMESPACE_SET = new Set<string>(ALLOWED_NAMESPACES);
const SLUG_BODY_RE  = /^[a-z0-9][a-z0-9_/-]*$/;
const INDEX_RE      = /^(0|[1-9][0-9]*)$/;

export function parseRef(ref: unknown): ParsedRef | null {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  const parts = ref.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  const ns = parts[0];
  if (!NAMESPACE_SET.has(ns)) return null;

  const body = parts[1];
  if (!SLUG_BODY_RE.test(body)) return null;

  if (parts.length === 2) {
    return { kind: 'slug', namespace: ns as Namespace, body };
  }

  const tail = parts[2];
  if (!INDEX_RE.test(tail)) return null;
  const index = Number(tail);
  if (!Number.isInteger(index) || index < 0) return null;

  return { kind: 'sprite', sheetSlug: `${ns}:${body}`, index };
}

export function serializeSpriteRef(sheetSlug: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`serializeSpriteRef: index must be a non-negative integer, got ${index}`);
  }
  return `${sheetSlug}:${index}`;
}

export function isSpriteRef(ref: string): boolean {
  return parseRef(ref)?.kind === 'sprite';
}
