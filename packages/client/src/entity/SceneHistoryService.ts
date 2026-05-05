// Host-only history service (PRD § Save / Load — issues #4 / #5).
//
// Tracks the most recently loaded file (`lastLoaded`) for Revert, and a ring
// buffer of undo entries with a redo stack. Pushes are pre-mutation: World
// mutators call `push(label)` at their top so undoing reverts the latest
// action. Save does not touch the stacks; Load and Revert clear both.

import { type EntitySerialized } from './Scene';

export interface LastLoaded {
  readonly snapshot: EntitySerialized[];
  readonly filename: string;
  readonly savedAt:  string;
}

export interface UndoEntry {
  readonly snapshot:  EntitySerialized[];
  readonly thumbnail: string | null;
  readonly label:     string;
  readonly timestamp: number;
}

export interface ReplaceSceneTarget {
  replaceScene(snaps: readonly EntitySerialized[]): void;
}

export interface SnapshotProvider {
  snapshot(): EntitySerialized[];
}

export interface SceneHistoryServiceOptions {
  // Maximum entries retained on the undo stack. Default 20.
  cap?: number;
  // Returns a JPEG data URL or null. Default returns null. ThreeCanvas wires
  // this to a 192×108 capture against the live canvas.
  captureThumb?: () => string | null;
}

const DEFAULT_CAP = 20;

export class SceneHistoryService {
  private lastLoaded_: LastLoaded | null = null;
  private undoStack_:  UndoEntry[] = [];
  private redoStack_:  UndoEntry[] = [];
  private listeners:   Array<() => void> = [];
  private readonly cap:          number;
  private readonly captureThumb: () => string | null;

  constructor(
    private readonly world: ReplaceSceneTarget & SnapshotProvider,
    opts: SceneHistoryServiceOptions = {},
  ) {
    this.cap          = opts.cap ?? DEFAULT_CAP;
    this.captureThumb = opts.captureThumb ?? (() => null);
  }

  get lastLoaded(): LastLoaded | null {
    return this.lastLoaded_;
  }

  entries(): readonly UndoEntry[] {
    return this.undoStack_;
  }

  redoEntries(): readonly UndoEntry[] {
    return this.redoStack_;
  }

  // Called by the Load flow on successful confirmation. Replaces the prior
  // tracked file and clears both undo and redo stacks (the loaded state
  // becomes the new root). Notifies subscribers.
  setLastLoaded(loaded: LastLoaded): void {
    this.lastLoaded_ = {
      snapshot: [...loaded.snapshot],
      filename: loaded.filename,
      savedAt:  loaded.savedAt,
    };
    this.undoStack_ = [];
    this.redoStack_ = [];
    this.notify();
  }

  // Capture `world.snapshot()` plus a thumbnail at the top of a host mutator.
  // Dedupes against the top entry (cheap JSON-equality check); evicts oldest
  // when the cap is exceeded; clears the redo stack so a fresh action does
  // not allow redo to reach a now-impossible future.
  push(label: string): void {
    const snapshot = this.world.snapshot();
    const top = this.undoStack_[this.undoStack_.length - 1];
    if (top && snapshotsEqual(top.snapshot, snapshot)) {
      // Dedupe — but a dedupe still clears redo, since the user attempted a
      // mutation. (Spec: "any new push clears the redo stack.")
      if (this.redoStack_.length > 0) {
        this.redoStack_ = [];
        this.notify();
      }
      return;
    }

    this.undoStack_.push({
      snapshot,
      thumbnail: this.captureThumb(),
      label,
      timestamp: Date.now(),
    });
    while (this.undoStack_.length > this.cap) this.undoStack_.shift();
    this.redoStack_ = [];
    this.notify();
  }

  // Restore the supplied entry's snapshot via World.replaceScene. The History
  // modal calls this on a row click. Does not touch the undo / redo stacks
  // beyond firing a notify — the modal pushes a "Current" anchor before
  // opening so the live state is always retrievable.
  restore(entry: UndoEntry): void {
    this.world.replaceScene(entry.snapshot);
    this.notify();
  }

  // Restore the most recently loaded snapshot. No-op when no file has been
  // loaded. Clears both stacks; the reverted state becomes the new root.
  revert(): boolean {
    if (!this.lastLoaded_) return false;
    this.world.replaceScene(this.lastLoaded_.snapshot);
    this.undoStack_ = [];
    this.redoStack_ = [];
    this.notify();
    return true;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  dispose(): void {
    this.lastLoaded_ = null;
    this.undoStack_  = [];
    this.redoStack_  = [];
    this.listeners   = [];
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

function snapshotsEqual(a: readonly EntitySerialized[], b: readonly EntitySerialized[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
