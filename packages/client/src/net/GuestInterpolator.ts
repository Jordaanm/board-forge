import { type ObjectState, type GameMessage, applyPatch } from './SceneState';

const INTERP_DELAY_MS = 100;
const MAX_BUFFER      = 120;

type Entry = { localTs: number; objects: ObjectState[] };

export class GuestInterpolator {
  private buffer: Entry[]      = [];
  private knownState: ObjectState[] = [];

  receive(msg: GameMessage) {
    if (msg.type === 'delete') {
      this.knownState = this.knownState.filter(o => o.id !== msg.id);
      this.buffer = this.buffer.map(e => ({
        localTs: e.localTs,
        objects: e.objects.filter(o => o.id !== msg.id),
      }));
      return;
    }
    if (msg.type === 'snapshot') {
      this.knownState = msg.objects;
    } else {
      this.knownState = applyPatch(this.knownState, msg.changed);
    }
    this.buffer.push({ localTs: performance.now(), objects: [...this.knownState] });
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
  }

  update(): ObjectState[] {
    if (this.buffer.length === 0) return [];
    if (this.buffer.length === 1) return this.buffer[0].objects;

    const renderTime = performance.now() - INTERP_DELAY_MS;

    let i = 0;
    while (i < this.buffer.length - 2 && this.buffer[i + 1].localTs <= renderTime) i++;

    const before = this.buffer[i];
    const after  = this.buffer[i + 1];
    const span   = after.localTs - before.localTs;
    if (span <= 0) return after.objects;

    const t = Math.max(0, Math.min(1, (renderTime - before.localTs) / span));
    return lerpStates(before.objects, after.objects, t);
  }
}

function lerpStates(a: ObjectState[], b: ObjectState[], t: number): ObjectState[] {
  const bMap = new Map(b.map(o => [o.id, o]));
  return a.map(ao => {
    const bo = bMap.get(ao.id);
    if (!bo) return ao;

    const qx = ao.qx + (bo.qx - ao.qx) * t;
    const qy = ao.qy + (bo.qy - ao.qy) * t;
    const qz = ao.qz + (bo.qz - ao.qz) * t;
    const qw = ao.qw + (bo.qw - ao.qw) * t;
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;

    return {
      id:         ao.id,
      objectType: ao.objectType,
      px: ao.px + (bo.px - ao.px) * t,
      py: ao.py + (bo.py - ao.py) * t,
      pz: ao.pz + (bo.pz - ao.pz) * t,
      qx: qx / len, qy: qy / len, qz: qz / len, qw: qw / len,
    };
  });
}
