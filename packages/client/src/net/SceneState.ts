export type SpawnableType = 'board' | 'die' | 'token';

export type ObjectState = {
  id: string;
  objectType: SpawnableType;
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
};

export type GameMessage =
  | { type: 'snapshot'; ts: number; objects: ObjectState[] }
  | { type: 'patch';    ts: number; changed: ObjectState[] };

export type GuestInputMessage =
  | { type: 'guest-drag-start'; objectId: string }
  | { type: 'guest-drag-move';  objectId: string; px: number; py: number; pz: number }
  | { type: 'guest-drag-end';   objectId: string; vx: number; vy: number; vz: number };

export type ChannelMessage = GameMessage | GuestInputMessage;

const DEFAULT_THRESHOLD = 0.0001;

export function diffObjects(prev: ObjectState[], curr: ObjectState[], threshold = DEFAULT_THRESHOLD): ObjectState[] {
  const prevMap = new Map(prev.map(o => [o.id, o]));
  return curr.filter(c => {
    const p = prevMap.get(c.id);
    if (!p) return true;
    return (
      Math.abs(c.px - p.px) > threshold ||
      Math.abs(c.py - p.py) > threshold ||
      Math.abs(c.pz - p.pz) > threshold ||
      Math.abs(c.qx - p.qx) > threshold ||
      Math.abs(c.qy - p.qy) > threshold ||
      Math.abs(c.qz - p.qz) > threshold ||
      Math.abs(c.qw - p.qw) > threshold
    );
  });
}

export function applyPatch(base: ObjectState[], changed: ObjectState[]): ObjectState[] {
  const patchMap = new Map(changed.map(o => [o.id, o]));
  const result = base.map(o => patchMap.get(o.id) ?? o);
  for (const o of changed) {
    if (!base.some(b => b.id === o.id)) result.push(o);
  }
  return result;
}
