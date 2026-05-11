// Pure save-flow utility extracted from ThreeCanvas's `saveSceneRef` body.
// Encodes the host's snapshot + thumbnail + script + manifest + turns into
// the standard envelope and triggers the browser download. Renderer concerns
// (capturing the thumbnail) stay in the caller — this helper is decoupled
// from WebGL so panels can compose it directly post-refactor.

import { type EntitySerialized } from './Scene';
import { type AssetEntry } from '../assets/Manifest';
import { encodeSaveFile, downloadSaveFile, type SavedScript } from './SaveFile';
import { type TurnState } from '../seats/TurnTracker';

export function downloadSceneFile(
  snapshot:  readonly EntitySerialized[],
  thumbnail: string | null,
  manifest:  readonly AssetEntry[],
  script:    SavedScript | undefined,
  turns?:    TurnState,
): void {
  const envelope = encodeSaveFile({
    scene: snapshot,
    thumbnail,
    manifest,
    script,
    turns,
  });
  downloadSaveFile(envelope);
}
