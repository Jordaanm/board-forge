// Card behaviour: owns face/back/category state, pushes texture URLs into the
// sibling MeshComponent's `face` and `back` slots, and keeps the sibling
// FlatViewComponent's `textureRef` aligned with the card's current orientation
// so 2D surfaces (hand panels, search) display the correct side.
// Slice 4 of issues--card.md.

import {
  EntityComponent,
  type SpawnContext,
} from '../EntityComponent';
import { type PropertyDef } from '../propertySchema';
import { TransformComponent } from './TransformComponent';
import { MeshComponent } from './MeshComponent';
import { PhysicsComponent } from './PhysicsComponent';
import { FlatViewComponent } from './FlatViewComponent';
import { isFaceUpFromQuaternion } from '../../card/cardOrientation';

export interface CardState {
  face:     string;
  back:     string;
  category: string;
}

export class CardComponent extends EntityComponent<CardState> {
  static typeId   = 'card';
  static label    = 'Card';
  static requires = ['transform', 'mesh', 'physics', 'flatview', 'tween'] as const;
  static propertySchema: readonly PropertyDef<CardState>[] = [
    { key: 'face', label: 'Face', type: 'asset:image' },
    { key: 'back', label: 'Back', type: 'asset:image' },
  ];

  private unsubscribeStop: (() => void) | null = null;

  onSpawn(_ctx: SpawnContext): void {
    this.pushTexturesToMesh();
    this.syncFlatView();
    const phys = this.entity.getComponent(PhysicsComponent);
    if (phys) {
      this.unsubscribeStop = phys.subscribeStopMoving(() => this.syncFlatView());
    }
  }

  onDespawn(_ctx: SpawnContext): void {
    if (this.unsubscribeStop) {
      this.unsubscribeStop();
      this.unsubscribeStop = null;
    }
  }

  onPropertiesChanged(changed: Partial<CardState>): void {
    if (changed.face !== undefined || changed.back !== undefined) {
      this.pushTexturesToMesh();
      this.syncFlatView();
    }
  }

  isFaceUp(): boolean {
    const transform = this.entity.getComponent(TransformComponent)!;
    const [qx, qy, qz, qw] = transform.state.rotation;
    return isFaceUpFromQuaternion(qx, qy, qz, qw);
  }

  private pushTexturesToMesh(): void {
    const mesh = this.entity.getComponent(MeshComponent);
    if (!mesh) return;
    mesh.setState({
      textureRefs: { ...mesh.state.textureRefs, face: this.state.face, back: this.state.back },
    });
  }

  private syncFlatView(): void {
    const flatview = this.entity.getComponent(FlatViewComponent);
    if (!flatview) return;
    const next = this.isFaceUp() ? this.state.face : this.state.back;
    if (flatview.state.textureRef !== next) {
      flatview.setState({ textureRef: next });
    }
  }
}
