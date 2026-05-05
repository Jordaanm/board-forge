// Deck of cards. Issue #2 of issues--deck.md.
//
// Owns `cards: string[]` (card entity IDs, top to bottom; index 0 is the
// visible top) and `category: string`. On `cards` change, patches the sibling
// MeshComponent.size (height = 0.02 × cards.length) and pushes the top card's
// face / bottom card's back into the mesh's `face` / `back` material slots.
// Also re-derives the sibling PhysicsComponent's mass and rebuilds its shape
// to match the new height.

import {
  EntityComponent,
  type SpawnContext,
} from '../EntityComponent';
import { MeshComponent } from './MeshComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { CardComponent } from './CardComponent';

export interface DeckState {
  cards:    string[];
  category: string;
}

// Per-card slab thickness used to grow the deck height. Twice the card
// thickness (cards have y-size 0.01) so each slab visibly stripes.
export const CARD_SLAB_HEIGHT = 0.02;
// Per-card mass. Mirrors the `card` spawnable's physics.mass. Inlined here to
// keep DeckComponent independent of the spawnable registry.
export const CARD_MASS = 0.05;

export class DeckComponent extends EntityComponent<DeckState> {
  static typeId   = 'deck';
  static requires = ['transform', 'mesh', 'physics'] as const;

  onSpawn(_ctx: SpawnContext): void {
    this.applyCardsToSiblings();
  }

  onPropertiesChanged(changed: Partial<DeckState>): void {
    if (changed.cards !== undefined) {
      this.applyCardsToSiblings();
    }
  }

  private applyCardsToSiblings(): void {
    const mesh = this.entity.getComponent(MeshComponent);
    if (!mesh) return;
    const n = this.state.cards.length;
    if (n === 0) return;

    const cur = mesh.state.size;
    const w = Array.isArray(cur) ? cur[0] : cur;
    const d = Array.isArray(cur) ? cur[2] : cur;
    const h = CARD_SLAB_HEIGHT * n;

    const topId    = this.state.cards[0];
    const bottomId = this.state.cards[n - 1];
    const topCard    = this.entity.scene?.getEntity(topId)?.getComponent(CardComponent);
    const bottomCard = this.entity.scene?.getEntity(bottomId)?.getComponent(CardComponent);

    mesh.setState({
      size: [w, h, d],
      textureRefs: {
        ...mesh.state.textureRefs,
        face: topCard?.state.face ?? '',
        back: bottomCard?.state.back ?? '',
      },
    });

    const phys = this.entity.getComponent(PhysicsComponent);
    if (phys) {
      phys.rebuildShape();
      phys.setState({ mass: CARD_MASS * n });
    }
  }
}
