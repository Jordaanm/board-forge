import { type ObjectState, type GameMessage, diffObjects } from './SceneState';
import { type SeatIndex } from '../seats/SeatLayout';
import {
  scrubFor,
  EMPTY_PRIVATE_FIELD_REGISTRY,
  type PrivateFieldRegistry,
} from '../seats/PrivacyScrubber';

const PATCH_INTERVAL_MS    = 1000 / 20;  // 50 ms — 20 Hz
const SNAPSHOT_INTERVAL_MS = 1000;        // 1 Hz

export interface ReplicationTarget {
  peerId:   string;
  peerSeat: SeatIndex | null;
  isHost:   boolean;
}

export interface ReplicationDeps {
  getTargets: () => ReplicationTarget[];
  sendTo:     (peerId: string, msg: GameMessage) => void;
  registry?:  PrivateFieldRegistry;
}

export class HostReplicator {
  private lastSent: ObjectState[] = [];
  private lastPatchAt    = 0;
  private lastSnapshotAt = 0;
  private readonly registry: PrivateFieldRegistry;

  constructor(private readonly deps: ReplicationDeps) {
    this.registry = deps.registry ?? EMPTY_PRIVATE_FIELD_REGISTRY;
  }

  update(objects: ObjectState[]) {
    const now = performance.now();

    if (now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      for (const t of this.deps.getTargets()) {
        const scrubbed = objects.map(o =>
          scrubFor({ peerSeat: t.peerSeat, isHost: t.isHost }, o, this.registry),
        );
        this.deps.sendTo(t.peerId, { type: 'snapshot', ts: now, objects: scrubbed });
      }
      this.lastSent       = objects;
      this.lastSnapshotAt = now;
      this.lastPatchAt    = now;
      return;
    }

    if (now - this.lastPatchAt >= PATCH_INTERVAL_MS) {
      const changed = diffObjects(this.lastSent, objects);
      if (changed.length > 0) {
        for (const t of this.deps.getTargets()) {
          const scrubbed = changed.map(o =>
            scrubFor({ peerSeat: t.peerSeat, isHost: t.isHost }, o, this.registry),
          );
          this.deps.sendTo(t.peerId, { type: 'patch', ts: now, changed: scrubbed });
        }
        this.lastSent = objects;
      }
      this.lastPatchAt = now;
    }
  }
}
