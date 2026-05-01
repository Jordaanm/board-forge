import * as THREE from 'three';
import { Scene, findEntityByObject3D } from '../entity/Scene';
import { TransformComponent } from '../entity/components/TransformComponent';
import { aggregateContextMenu } from '../entity/contextMenu';
import { type Entity } from '../entity/Entity';
import { type MenuContext, type MenuItem, type ActionContext } from '../entity/EntityComponent';
import { type ChannelMessage } from '../net/SceneState';
import { type SeatIndex } from '../seats/SeatLayout';
import { canManipulate } from '../seats/OwnershipPolicy';

export interface ContextMenuRequest {
  x:          number;
  y:          number;
  entityId:   string;
  entityName: string;
  items:      MenuItem[];
}

const MENU_W        = 175;
const MENU_ITEM_H   = 36;
const MENU_HEADER_H = 44;
const MENU_PADDING  = 12;

// Transitional host-only built-in. Roll has migrated onto ValueComponent;
// Delete is still pending a home (see todo.md — base class vs. editor panel).
const BUILTIN_DELETE: MenuItem = { kind: 'action', id: '__delete', label: 'Delete' };

export class ContextMenuController {
  constructor(
    private readonly element:     HTMLElement,
    private readonly camera:      THREE.PerspectiveCamera,
    private readonly isHost:      boolean,
    private readonly getSelfSeat: () => SeatIndex | null,
    private readonly onOpen:      (req: ContextMenuRequest) => void,
  ) {
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose() {
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();

    const rect = this.element.getBoundingClientRect();
    const ptr  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, this.camera);

    const meshes: THREE.Object3D[] = [];
    for (const ent of Scene.all()) {
      const t = ent.getComponent(TransformComponent);
      if (t?.object3d) meshes.push(t.object3d);
    }
    const hits = ray.intersectObjects(meshes, true);
    if (!hits.length) return;

    const entity = findEntityByObject3D(hits[0].object);
    if (!entity) return;

    const seat = this.getSelfSeat();
    const ctx: MenuContext = { recipientSeat: seat, isHost: this.isHost, entity };
    const items = aggregateContextMenu(entity, ctx);

    // Append host-only built-ins (Delete always; Roll for dice).
    if (this.isHost) {
      const builtins = builtinHostActions(entity);
      if (builtins.length > 0) {
        if (items.length > 0) items.push({ kind: 'separator' });
        items.push(...builtins);
      }
    }

    if (items.length === 0) return;

    const itemCount = countLeafItems(items);
    const menuH     = MENU_HEADER_H + itemCount * MENU_ITEM_H + MENU_PADDING;

    this.onOpen({
      x:          Math.min(e.clientX, window.innerWidth  - MENU_W),
      y:          Math.min(e.clientY, window.innerHeight - menuH),
      entityId:   entity.id,
      entityName: entity.name,
      items,
    });
  };
}

function builtinHostActions(_entity: Entity): MenuItem[] {
  return [BUILTIN_DELETE];
}

function countLeafItems(items: MenuItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.kind === 'separator' || item.kind === 'heading') continue;
    n += 1;
  }
  return n;
}

// ── Click routing ──────────────────────────────────────────────────────────
// Called by the React UI when the user clicks a menu action. Encapsulates
// the host-local vs. invoke-action decision so the UI just forwards (item,
// args) into here.

export interface MenuActionDeps {
  isHost:        boolean;
  entity:        Entity | undefined;        // resolved at request time
  send:          (msg: ChannelMessage) => void;
  hostLocal: {
    delete:      (entityId: string) => void;
  };
  selfSeat:      SeatIndex | null;
}

export function dispatchMenuAction(
  item:    MenuItem & { kind: 'action' },
  args:    object | undefined,
  entityId: string,
  deps:    MenuActionDeps,
): void {
  // Built-in host-only action short-circuits straight to the host runtime.
  if (item.id === '__delete') { if (deps.isHost) deps.hostLocal.delete(entityId); return; }

  if (!item.componentTypeId) return; // unknown action — drop
  if (deps.isHost && deps.entity) {
    // Host runs onAction locally without a round-trip RPC.
    if (!canManipulate({ peerSeat: deps.selfSeat, isHost: true }, deps.entity.owner)) return;
    const comp = deps.entity.components.get(item.componentTypeId);
    if (!comp) return;
    const actionCtx: ActionContext = {
      recipientSeat: deps.selfSeat, isHost: true, entity: deps.entity,
    };
    comp.onAction(item.id, args, actionCtx);
    return;
  }

  deps.send({
    type: 'invoke-action',
    entityId,
    componentTypeId: item.componentTypeId,
    actionId: item.id,
    ...(args !== undefined ? { args } : {}),
  });
}
