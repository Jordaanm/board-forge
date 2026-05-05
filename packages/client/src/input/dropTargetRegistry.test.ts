// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import {
  registerDropTarget,
  findDropTargetAt,
  clearDropTargets,
  type DropTargetMetadata,
} from './dropTargetRegistry';

afterEach(() => {
  clearDropTargets();
  document.body.innerHTML = '';
});

function spawnDiv(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

describe('dropTargetRegistry', () => {
  test('findDropTargetAt returns null when no targets registered', () => {
    document.elementFromPoint = (() => null) as Document['elementFromPoint'];
    expect(findDropTargetAt(0, 0)).toBeNull();
  });

  test('returns the metadata of the registered element under the pointer', () => {
    const el = spawnDiv();
    const metadata: DropTargetMetadata = { kind: 'hand-panel', handEntityId: 'h1' };
    registerDropTarget(el, metadata);
    document.elementFromPoint = (() => el) as Document['elementFromPoint'];

    expect(findDropTargetAt(50, 60)).toEqual(metadata);
  });

  test('matches when the elementFromPoint hit is a descendant of the registered element', () => {
    const panel = spawnDiv();
    const child = document.createElement('span');
    panel.appendChild(child);
    registerDropTarget(panel, { kind: 'hand-panel', handEntityId: 'h2' });
    document.elementFromPoint = (() => child) as Document['elementFromPoint'];

    expect(findDropTargetAt(0, 0)).toEqual({ kind: 'hand-panel', handEntityId: 'h2' });
  });

  test('returns null for a point that hits an unregistered element', () => {
    const registered = spawnDiv();
    registerDropTarget(registered, { kind: 'hand-panel', handEntityId: 'h1' });
    const stranger = spawnDiv();
    document.elementFromPoint = (() => stranger) as Document['elementFromPoint'];

    expect(findDropTargetAt(0, 0)).toBeNull();
  });

  test('unregister removes the target', () => {
    const el = spawnDiv();
    const unregister = registerDropTarget(el, { kind: 'hand-panel', handEntityId: 'h1' });
    document.elementFromPoint = (() => el) as Document['elementFromPoint'];
    expect(findDropTargetAt(0, 0)).not.toBeNull();

    unregister();
    expect(findDropTargetAt(0, 0)).toBeNull();
  });
});
