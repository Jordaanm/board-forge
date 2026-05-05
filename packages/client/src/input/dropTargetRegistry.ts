// Decouples React-rendered drop targets from input tools that consult them on
// pointer release. Panels register their root element + a metadata payload on
// mount and deregister on unmount; a tool calls `findDropTargetAt(x, y)` to
// resolve the target under a screen-space coordinate.
//
// Issue #7 of planning/issues--hand.md (drag canvas → hand panel).

export type DropTargetMetadata =
  | { kind: 'hand-panel'; handEntityId: string };

interface Entry {
  element:  HTMLElement;
  metadata: DropTargetMetadata;
}

const entries = new Set<Entry>();

// Registers a DOM element as a drop target. Returns an unregister function.
// Idempotent: re-registering the same (element, metadata) pair adds a fresh
// entry; the returned unregister removes only that entry.
export function registerDropTarget(element: HTMLElement, metadata: DropTargetMetadata): () => void {
  const entry: Entry = { element, metadata };
  entries.add(entry);
  return () => { entries.delete(entry); };
}

// Resolves the topmost registered drop target whose element contains the
// coordinate. Returns the entry's metadata, or null if no drop target lies
// under (clientX, clientY).
export function findDropTargetAt(clientX: number, clientY: number): DropTargetMetadata | null {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  for (const entry of entries) {
    if (entry.element === el || entry.element.contains(el)) return entry.metadata;
  }
  return null;
}

// Test seam — clears the registry between tests.
export function clearDropTargets(): void {
  entries.clear();
}
