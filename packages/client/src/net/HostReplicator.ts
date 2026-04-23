import { type ObjectState, type GameMessage, diffObjects } from './SceneState';

const PATCH_INTERVAL_MS    = 1000 / 20;  // 50 ms  — 20 Hz
const SNAPSHOT_INTERVAL_MS = 1000;        // 1 Hz

export class HostReplicator {
  private lastSent: ObjectState[] = [];
  private lastPatchAt    = 0;
  private lastSnapshotAt = 0;

  constructor(private readonly send: (msg: GameMessage) => void) {}

  update(objects: ObjectState[]) {
    const now = performance.now();

    if (now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      this.send({ type: 'snapshot', ts: now, objects });
      this.lastSent       = objects;
      this.lastSnapshotAt = now;
      this.lastPatchAt    = now;
      return;
    }

    if (now - this.lastPatchAt >= PATCH_INTERVAL_MS) {
      const changed = diffObjects(this.lastSent, objects);
      if (changed.length > 0) {
        this.send({ type: 'patch', ts: now, changed });
        this.lastSent = objects;
      }
      this.lastPatchAt = now;
    }
  }
}
