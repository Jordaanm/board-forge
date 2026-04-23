import * as THREE from 'three';
import { type SpawnableType } from '../net/SceneState';
import { type ActionDef, OBJECT_TYPE_REGISTRY } from '../scene/objectTypes';
import { type SceneGraph } from '../scene/SceneGraph';

export type ContextMenuRequest = {
  x: number;
  y: number;
  objectId: string;
  objectType: SpawnableType;
  objectName: string;
  actions: ActionDef[];
};

const MENU_W        = 175;
const MENU_ITEM_H   = 36;
const MENU_HEADER_H = 44;
const MENU_PADDING  = 12;

export class ContextMenuController {
  constructor(
    private readonly element: HTMLElement,
    private readonly camera:  THREE.PerspectiveCamera,
    private readonly graph:   SceneGraph,
    private readonly onOpen:  (req: ContextMenuRequest) => void,
    // When provided, the menu only opens if the hit object's id matches the
    // currently-selected id. Used on the guest path where a menu requires
    // the object to already be selected.
    private readonly requireSelectedId?: () => string | null,
  ) {
    // The browser fires 'contextmenu' only on a stationary right-click, not
    // during a right-drag, so drag-suppression is handled for us automatically.
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose() {
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault(); // suppress native browser menu

    const rect = this.element.getBoundingClientRect();
    const ptr  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, this.camera);

    const hits = ray.intersectObjects(this.graph.getAll().map(en => en.mesh), true);
    if (!hits.length) return;

    const entry = this.graph.findEntry(hits[0].object);
    if (!entry) return;

    if (this.requireSelectedId && this.requireSelectedId() !== entry.id) return;

    const def       = OBJECT_TYPE_REGISTRY[entry.objectType];
    const itemCount = def.actions.length + 1; // +1 for Delete
    const menuH     = MENU_HEADER_H + itemCount * MENU_ITEM_H + MENU_PADDING;
    const nameProp  = entry.props['name'];
    const objectName = typeof nameProp === 'string' ? nameProp : entry.id;

    this.onOpen({
      x:          Math.min(e.clientX, window.innerWidth  - MENU_W),
      y:          Math.min(e.clientY, window.innerHeight - menuH),
      objectId:   entry.id,
      objectType: entry.objectType,
      objectName,
      actions:    def.actions,
    });
  };
}
