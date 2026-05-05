// Host-only service that merges entities on contact.
// Issue #2 of issues--deck.md.
//
// `canMerge(a, b)` is the gating predicate (held / private-to-seat /
// already-contained / category-mismatch). `merge(a, b)` runs the actual
// transformation. The card↔card path spawns a new `deck` entity at the lower
// (lower-Y) card's pose, parents both cards under the deck with
// `isContained=true`, and orders the deck's `cards` with the upper card at
// index 0 (the visible top).
//
// The host wires beginContact on its physics world to call
// `tryMergeOnContact(a, b)` when two PhysicsComponent bodies first touch.

import { type Entity } from './Entity';
import { type SceneImpl } from './Scene';
import { type HostReplicatorV2 } from './HostReplicatorV2';
import { CardComponent } from './components/CardComponent';
import { DeckComponent } from './components/DeckComponent';
import { TransformComponent } from './components/TransformComponent';

export interface MergeHostFacade {
  // Spawns an entity of the given type at the supplied position; returns the
  // backing Entity (not a handle) so MergeService can patch component state
  // before any physics tick runs.
  spawnAt(type: string, position: [number, number, number]): Entity;
}

export class MergeService {
  // Pairs queued from beginContact, drained from `processQueued()` once the
  // physics step has fully integrated. Modifying the world's body list inside
  // the beginContact dispatch is unsafe — cannon-es is mid-iteration.
  private queued: Array<[string, string]> = [];

  constructor(
    private readonly scene:      SceneImpl,
    private readonly replicator: HostReplicatorV2,
    private readonly host:       MergeHostFacade,
  ) {}

  // Host-only. Called by the World's beginContact handler. Defers the actual
  // merge work to the next `processQueued()` call.
  enqueueContact(a: Entity, b: Entity): void {
    if (!this.canMerge(a, b)) return;
    this.queued.push([a.id, b.id]);
  }

  // Drains the queue, running merges for any pairs still passing canMerge.
  // Called from World.tick() after physics.step().
  processQueued(): void {
    if (this.queued.length === 0) return;
    const pairs = this.queued;
    this.queued = [];
    const merged = new Set<string>();
    for (const [aId, bId] of pairs) {
      if (merged.has(aId) || merged.has(bId)) continue;
      const a = this.scene.getEntity(aId);
      const b = this.scene.getEntity(bId);
      if (!a || !b) continue;
      const result = this.merge(a, b);
      if (result) {
        merged.add(aId);
        merged.add(bId);
      }
    }
  }

  canMerge(a: Entity, b: Entity): boolean {
    if (a === b) return false;
    if (a.heldBy !== null || b.heldBy !== null) return false;
    if (a.privateToSeat !== null || b.privateToSeat !== null) return false;
    if (a.isContained || b.isContained) return false;

    const aCard = a.getComponent(CardComponent);
    const bCard = b.getComponent(CardComponent);

    if (aCard && bCard) {
      return aCard.state.category === bCard.state.category;
    }
    return false;
  }

  merge(a: Entity, b: Entity): Entity | null {
    if (!this.canMerge(a, b)) return null;
    const aCard = a.getComponent(CardComponent);
    const bCard = b.getComponent(CardComponent);
    if (aCard && bCard) {
      return this.mergeCardCard(a, b);
    }
    return null;
  }

  // Convenience entry point for tests / direct callers. Production host uses
  // enqueueContact + processQueued to keep mutations out of the physics step.
  tryMergeOnContact(a: Entity, b: Entity): Entity | null {
    return this.merge(a, b);
  }

  private mergeCardCard(a: Entity, b: Entity): Entity {
    const aPos = a.getComponent(TransformComponent)!.state.position;
    const bPos = b.getComponent(TransformComponent)!.state.position;
    // Lower (lower-Y) becomes the bottom card; the other lands on top as the
    // newer arrival (index 0 of `cards`).
    const lower = aPos[1] <= bPos[1] ? a : b;
    const upper = aPos[1] <= bPos[1] ? b : a;
    const lowerPos = lower.getComponent(TransformComponent)!.state.position;
    const category = a.getComponent(CardComponent)!.state.category;

    const deck = this.host.spawnAt('deck', lowerPos);
    const cards = [upper.id, lower.id];

    const name = category ? `Deck of ${category}` : `Deck-${deck.id.slice(0, 8)}`;
    deck.name = name;
    this.replicator.enqueueEntityPatch(deck.id, { name });

    deck.children = [...cards];
    this.replicator.enqueueEntityPatch(deck.id, { children: [...cards] });

    deck.getComponent(DeckComponent)!.setState({ cards, category });

    setEntityIsContained(upper, true,    this.replicator);
    setEntityIsContained(lower, true,    this.replicator);
    setEntityParentId   (upper, deck.id, this.replicator);
    setEntityParentId   (lower, deck.id, this.replicator);

    return deck;
  }
}

function setEntityIsContained(entity: Entity, value: boolean, repl: HostReplicatorV2): void {
  if (entity.isContained === value) return;
  entity.isContained = value;
  for (const comp of entity.components.values()) comp.onIsContainedChanged(value);
  repl.enqueueEntityPatch(entity.id, { isContained: value });
}

function setEntityParentId(entity: Entity, parentId: string | null, repl: HostReplicatorV2): void {
  entity.parentId = parentId;
  repl.enqueueEntityPatch(entity.id, { parentId });
}
