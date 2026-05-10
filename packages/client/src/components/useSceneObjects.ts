// Subscribes to a `SceneController`'s scene graph and returns the panel-shaped
// `ObjectSummary[]` snapshot. Replaces the hand-wired `onObjectsChangeRef`
// pattern that previously pushed snapshots from inside ThreeCanvas's effect.
//
// Subscription model: `useEffect` + `useState` + `controller.subscribe`.
// Not `useSyncExternalStore` — that requires referentially stable snapshots,
// which would force memoization inside `World`. Premature for a codebase not
// using concurrent rendering features.

import { useEffect, useState } from 'react';
import { type SceneController } from '../entity/world';
import { type Entity } from '../entity/Entity';
import { SurfaceComponent } from '../entity/components/SurfaceComponent';
import { aggregatePropertySchema } from '../entity/propertySchema';
import { type SpawnableType } from '../net/SceneState';
import { type ObjectSummary } from './EditorPanel';

export function useSceneObjects(
  controller: SceneController | null,
  isHost:     boolean,
): ObjectSummary[] {
  const [objects, setObjects] = useState<ObjectSummary[]>([]);
  useEffect(() => {
    if (!controller) {
      setObjects([]);
      return;
    }
    const update = () => {
      setObjects(controller.all().map(h => entityToObjectSummary(h.entity, isHost)));
    };
    update();
    return controller.subscribe(update);
  }, [controller, isHost]);
  return objects;
}

// Editor-panel view of an entity. Aggregates per-component schema sections
// for the panel's Entity + per-component layout, plus the SurfaceSummary used
// by the Surface elements list. Lives here (not on `World`) so the engine
// stays free of UI-shape methods.
export function entityToObjectSummary(entity: Entity, isHost: boolean): ObjectSummary {
  const surfaceComp = entity.getComponent(SurfaceComponent);
  const surface = surfaceComp ? {
    canvasSize: [...surfaceComp.state.canvasSize] as [number, number],
    elements:   surfaceComp.state.elements.map(el => ({ ...el })),
  } : null;
  const sections = aggregatePropertySchema(entity, { isHost });
  return {
    id:         entity.id,
    objectType: entity.type as SpawnableType,
    name:       entity.name,
    owner:      entity.owner,
    tags:       [...entity.tags],
    sections,
    parentId:   entity.parentId,
    surface,
  };
}
