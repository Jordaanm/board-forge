import { type SceneGraph } from '../scene/SceneGraph';
import { type GuestInputMessage } from '../net/SceneState';

// Applied on the host to handle drag inputs sent from the guest.
export class GuestInputHandler {
  private heldObjectId: string | null = null;
  private carryX = 0;
  private carryY = 0;
  private carryZ = 0;

  handleMessage(msg: GuestInputMessage, graph: SceneGraph) {
    if (msg.type === 'guest-drag-start') {
      this.heldObjectId = msg.objectId;
    } else if (msg.type === 'guest-drag-move') {
      this.carryX = msg.px;
      this.carryY = msg.py;
      this.carryZ = msg.pz;
    } else if (msg.type === 'guest-drag-end') {
      const entry = graph.getEntry(msg.objectId);
      if (entry?.body) {
        entry.body.velocity.set(msg.vx, msg.vy, msg.vz);
        entry.body.angularVelocity.setZero();
        entry.body.wakeUp();
      }
      this.heldObjectId = null;
    }
  }

  // Call each frame after physics.step() to hold the object in place.
  update(graph: SceneGraph) {
    if (!this.heldObjectId) return;
    const entry = graph.getEntry(this.heldObjectId);
    if (!entry?.body) return;
    entry.body.wakeUp();
    entry.body.position.set(this.carryX, this.carryY, this.carryZ);
    entry.body.velocity.setZero();
    entry.body.angularVelocity.setZero();
  }
}
