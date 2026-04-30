import type { WebSocket } from 'ws';
import { join, leave, lookup, getMember, getRoomMembers, type Role } from './rooms';

type Msg = {
  type:          string;
  roomId?:       string;
  role?:         Role;
  targetPeerId?: string;
  [k: string]:   unknown;
};

const FORWARDABLE = new Set(['offer', 'answer', 'ice-candidate']);

function send(ws: WebSocket, data: unknown) {
  ws.send(JSON.stringify(data));
}

export function onMessage(ws: WebSocket, raw: string) {
  let msg: Msg;
  try { msg = JSON.parse(raw) as Msg; } catch { return; }

  if (msg.type === 'join') {
    handleJoin(ws, msg);
    return;
  }

  if (FORWARDABLE.has(msg.type)) {
    handleForward(ws, msg);
  }
}

function handleJoin(ws: WebSocket, msg: Msg) {
  const { roomId, role } = msg;
  if (!roomId || (role !== 'host' && role !== 'guest')) return;

  const result = join(roomId, role, ws);
  if (result === 'full') {
    send(ws, { type: 'room-full' });
    return;
  }

  send(ws, {
    type:       'joined',
    peerId:     result.peerId,
    role,
    hostId:     result.hostId,
    otherPeers: result.otherPeers,
  });

  // Notify existing members of the new peer.
  for (const other of result.otherPeers) {
    const member = getMember(roomId, other.peerId);
    if (member) send(member.ws, { type: 'peer-joined', peerId: result.peerId, role });
  }
}

function handleForward(ws: WebSocket, msg: Msg) {
  const info = lookup(ws);
  if (!info || !msg.targetPeerId) return;
  const target = getMember(info.roomId, msg.targetPeerId);
  if (!target) return;
  send(target.ws, { ...msg, fromPeerId: info.peerId, targetPeerId: undefined });
}

export function onClose(ws: WebSocket) {
  const info = leave(ws);
  if (!info) return;
  for (const m of getRoomMembers(info.roomId)) {
    send(m.ws, { type: 'peer-left', peerId: info.peerId });
  }
}
