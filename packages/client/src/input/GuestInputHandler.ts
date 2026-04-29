import { type ISceneSystem } from '../scene/SceneGraph';
import { type GuestInputMessage } from '../net/SceneState';

interface PeerHold {
  heldObjectId: string | null;
  carryX:       number;
  carryY:       number;
  carryZ:       number;
}

// Applied on the host to handle drag inputs sent from guests. State is tracked
// per-peer so multiple guests can drag different objects simultaneously.
export class GuestInputHandler {
  private peers = new Map<string, PeerHold>();

  handleMessage(peerId: string, msg: GuestInputMessage, graph: ISceneSystem) {
    const peer = this.getOrCreate(peerId);

    if (msg.type === 'guest-drag-start') {
      peer.heldObjectId = msg.objectId;
    } else if (msg.type === 'guest-drag-move') {
      peer.carryX = msg.px;
      peer.carryY = msg.py;
      peer.carryZ = msg.pz;
    } else if (msg.type === 'guest-drag-end') {
      const entry = graph.getEntry(msg.objectId);
      if (entry?.body) {
        entry.body.velocity.set(msg.vx, msg.vy, msg.vz);
        entry.body.angularVelocity.setZero();
        entry.body.wakeUp();
      }
      peer.heldObjectId = null;
    }
  }

  // Call each frame after physics.step() to hold all carried objects in place.
  update(graph: ISceneSystem) {
    for (const peer of this.peers.values()) {
      if (!peer.heldObjectId) continue;
      const entry = graph.getEntry(peer.heldObjectId);
      if (!entry?.body) continue;
      entry.body.wakeUp();
      entry.body.position.set(peer.carryX, peer.carryY, peer.carryZ);
      entry.body.velocity.setZero();
      entry.body.angularVelocity.setZero();
    }
  }

  // Wake the body so it falls naturally rather than freezing mid-air.
  releasePeer(peerId: string, graph: ISceneSystem) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (peer.heldObjectId) {
      const entry = graph.getEntry(peer.heldObjectId);
      if (entry?.body) entry.body.wakeUp();
    }
    this.peers.delete(peerId);
  }

  private getOrCreate(peerId: string): PeerHold {
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = { heldObjectId: null, carryX: 0, carryY: 0, carryZ: 0 };
      this.peers.set(peerId, peer);
    }
    return peer;
  }
}
