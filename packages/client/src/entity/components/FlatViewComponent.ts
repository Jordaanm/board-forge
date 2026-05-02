// 2D appearance for an entity — used by hand panels, search interfaces, and
// other flat surfaces that render entities outside the 3D scene. No view
// artefact; the URL is consumed by UI code that renders an <img>/sprite.

import { EntityComponent } from '../EntityComponent';

export interface FlatViewState {
  textureRef: string;
}

export class FlatViewComponent extends EntityComponent<FlatViewState> {
  static typeId = 'flatview';

  onSpawn(): void { /* no view */ }
  onPropertiesChanged(): void { /* no view */ }
}
