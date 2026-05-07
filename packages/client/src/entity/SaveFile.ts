// Save-file envelope for the host's scene (PRD § Save / Load).
//
// Single JSON document with shape `{ format, version, savedAt, thumbnail,
// scene, script }`. `format` is the sentinel `"vtt-scene"`; `version` is an
// integer starting at 1; `scene` is the existing `EntitySerialized[]` shape
// produced by `World.snapshot`. `thumbnail` is a lossless PNG data URL (so
// the future steganography path can embed the save payload in the pixels
// without JPEG resampling corrupting it); `savedAt` is an ISO timestamp;
// `script` carries the host's authored script source plus its `initialised`
// flag (issues--scripting-v1.md §2).
//
// Validation on `decode` rejects unknown `format`, unknown `version`, missing
// required fields, or any unknown component `typeId` in `scene`. Optional
// fields (`thumbnail`, `savedAt`, `script`) are tolerated when absent — a
// missing `script` is treated as `{ source: '', initialised: false }` so
// pre-scripting save files keep loading.

import { type EntitySerialized } from './Scene';
import { componentRegistry } from './ComponentRegistry';
import { type AssetEntry, type AssetType, validateSlug } from '../assets/Manifest';

export const SAVE_FORMAT  = 'vtt-scene';
export const SAVE_VERSION = 1;

const ASSET_TYPES: ReadonlySet<AssetType> = new Set(['image', 'model', 'sound']);

export interface SavedScript {
  source:      string;
  initialised: boolean;
}

export const EMPTY_SCRIPT: SavedScript = { source: '', initialised: false };

export interface SaveEnvelope {
  format:    typeof SAVE_FORMAT;
  version:   typeof SAVE_VERSION;
  savedAt:   string;
  thumbnail: string | null;
  scene:     EntitySerialized[];
  script:    SavedScript;
  manifest:  AssetEntry[];
}

export interface EncodeOptions {
  scene:     readonly EntitySerialized[];
  thumbnail: string | null;
  savedAt?:  string;  // defaults to new Date().toISOString()
  script?:   SavedScript;
  manifest?: readonly AssetEntry[];
}

export function encodeSaveFile(opts: EncodeOptions): SaveEnvelope {
  return {
    format:    SAVE_FORMAT,
    version:   SAVE_VERSION,
    savedAt:   opts.savedAt ?? new Date().toISOString(),
    thumbnail: opts.thumbnail,
    scene:     [...opts.scene],
    script:    opts.script ?? { ...EMPTY_SCRIPT },
    manifest:  opts.manifest ? opts.manifest.map(cloneAssetEntry) : [],
  };
}

export class SaveFileError extends Error {}

// Parses a JSON string and validates the envelope. Throws SaveFileError with
// a human-readable message on any validation failure; never returns partially
// decoded state. Consumers display the message in an error modal.
export function decodeSaveFile(text: string): SaveEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SaveFileError('File is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SaveFileError('File is not a save envelope.');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.format !== SAVE_FORMAT) {
    throw new SaveFileError(`Unknown save format: ${JSON.stringify(obj.format)}`);
  }
  if (obj.version !== SAVE_VERSION) {
    throw new SaveFileError(`Unsupported save version: ${JSON.stringify(obj.version)}`);
  }
  if (!Array.isArray(obj.scene)) {
    throw new SaveFileError('Save file is missing required field "scene".');
  }

  const scene = obj.scene.map((e, i) => validateEntitySerialized(e, i));

  const thumbnail = obj.thumbnail === undefined ? null
    : typeof obj.thumbnail === 'string' ? obj.thumbnail
    : obj.thumbnail === null            ? null
    : (() => { throw new SaveFileError('Field "thumbnail" must be a string or null.'); })();

  const savedAt = obj.savedAt === undefined ? ''
    : typeof obj.savedAt === 'string'    ? obj.savedAt
    : (() => { throw new SaveFileError('Field "savedAt" must be a string.'); })();

  return {
    format:    SAVE_FORMAT,
    version:   SAVE_VERSION,
    savedAt,
    thumbnail,
    scene,
    script:    decodeScript(obj.script),
    manifest:  decodeManifest(obj.manifest),
  };
}

function decodeManifest(raw: unknown): AssetEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new SaveFileError('Field "manifest" must be an array.');
  }
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SaveFileError(`manifest[${i}] is not an object.`);
    }
    const e = entry as Record<string, unknown>;
    const slugCheck = validateSlug(e.slug);
    if (!slugCheck.ok) throw new SaveFileError(`manifest[${i}].slug invalid: ${slugCheck.error}`);
    const slug = e.slug as string;
    if (seen.has(slug)) throw new SaveFileError(`manifest[${i}] duplicate slug "${slug}".`);
    seen.add(slug);
    if (typeof e.name !== 'string' || e.name.length === 0) {
      throw new SaveFileError(`manifest[${i}].name must be a non-empty string.`);
    }
    if (typeof e.type !== 'string' || !ASSET_TYPES.has(e.type as AssetType)) {
      throw new SaveFileError(`manifest[${i}].type must be one of image|model|sound.`);
    }
    if (typeof e.url !== 'string') {
      throw new SaveFileError(`manifest[${i}].url must be a string.`);
    }
    if (typeof e.preload !== 'boolean') {
      throw new SaveFileError(`manifest[${i}].preload must be a boolean.`);
    }
    if (e.description !== undefined && typeof e.description !== 'string') {
      throw new SaveFileError(`manifest[${i}].description must be a string.`);
    }
    if (e.tags !== undefined) {
      if (!Array.isArray(e.tags) || e.tags.some(t => typeof t !== 'string')) {
        throw new SaveFileError(`manifest[${i}].tags must be a string array.`);
      }
    }
    return {
      slug,
      name:        e.name,
      type:        e.type as AssetType,
      url:         e.url,
      preload:     e.preload,
      description: e.description as string | undefined,
      tags:        e.tags ? [...(e.tags as string[])] : undefined,
    };
  });
}

function cloneAssetEntry(e: AssetEntry): AssetEntry {
  return {
    slug:        e.slug,
    name:        e.name,
    type:        e.type,
    url:         e.url,
    preload:     e.preload,
    description: e.description,
    tags:        e.tags ? [...e.tags] : undefined,
  };
}

function decodeScript(raw: unknown): SavedScript {
  if (raw === undefined || raw === null) return { ...EMPTY_SCRIPT };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SaveFileError('Field "script" must be an object.');
  }
  const s = raw as Record<string, unknown>;
  const source = s.source ?? '';
  if (typeof source !== 'string') {
    throw new SaveFileError('Field "script.source" must be a string.');
  }
  const initialised = s.initialised ?? false;
  if (typeof initialised !== 'boolean') {
    throw new SaveFileError('Field "script.initialised" must be a boolean.');
  }
  return { source, initialised };
}

function validateEntitySerialized(raw: unknown, index: number): EntitySerialized {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SaveFileError(`scene[${index}] is not an object.`);
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.id   !== 'string') throw new SaveFileError(`scene[${index}].id must be a string.`);
  if (typeof e.type !== 'string') throw new SaveFileError(`scene[${index}].type must be a string.`);
  if (typeof e.name !== 'string') throw new SaveFileError(`scene[${index}].name must be a string.`);
  if (!e.components || typeof e.components !== 'object' || Array.isArray(e.components)) {
    throw new SaveFileError(`scene[${index}].components must be an object.`);
  }
  for (const typeId of Object.keys(e.components as Record<string, unknown>)) {
    if (!componentRegistry.get(typeId)) {
      throw new SaveFileError(`scene[${index}] references unknown component "${typeId}".`);
    }
  }
  return e as unknown as EntitySerialized;
}

// Browser-only download helper: serialise the envelope and trigger an anchor
// click against a Blob URL. Default filename is `vtt-scene-<ISO date>.json`.
// Wrapped in an exported helper so non-browser tests can construct the
// envelope without invoking DOM APIs.
export function downloadSaveFile(envelope: SaveEnvelope, filename?: string): void {
  const json = JSON.stringify(envelope);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename ?? defaultSaveFilename(envelope.savedAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function defaultSaveFilename(isoTimestamp: string): string {
  const dateOnly = isoTimestamp.slice(0, 10);  // YYYY-MM-DD
  return `vtt-scene-${dateOnly || 'unknown'}.json`;
}
