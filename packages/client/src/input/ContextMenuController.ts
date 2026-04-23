import * as THREE from 'three';
import { type SpawnableType } from '../net/SceneState';
import { type ActionDef, OBJECT_TYPE_REGISTRY } from '../scene/objectTypes';
import { type SceneGraph } from '../scene/SceneGraph';

export type ContextMenuRequest = {
  x: number;
  y: number;
  objectId: string;
  objectType: SpawnableType;
  actions: ActionDef[];
};

const MOVE_THRESHOLD_SQ = 25; // 5 px
const MENU_W            = 175;
const MENU_ITEM_H       = 36;
const MENU_PADDING      = 12;

export class ContextMenuController {
  private startX = 0;
  private startY = 0;
  private moved  = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly camera:  THREE.PerspectiveCamera,
    private readonly graph:   SceneGraph,
    private readonly onOpen:  (req: ContextMenuRequest) => void,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup',   this.onUp);
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup',   this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 2) return;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.moved  = false;
  };

  private onMove = (e: PointerEvent) => {
    if (!(e.buttons & 2)) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) this.moved = true;
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 2 || this.moved) return;

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

    const def     = OBJECT_TYPE_REGISTRY[entry.objectType];
    const itemCount = def.actions.length + 1; // +1 for Delete
    const menuH   = itemCount * MENU_ITEM_H + MENU_PADDING;

    const x = Math.min(e.clientX, window.innerWidth  - MENU_W);
    const y = Math.min(e.clientY, window.innerHeight - menuH);

    this.onOpen({
      x, y,
      objectId:   entry.id,
      objectType: entry.objectType,
      actions:    def.actions,
    });
  };
}
