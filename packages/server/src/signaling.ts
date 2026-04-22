import type { WebSocket } from 'ws';
import { join, getPeer, leave } from './rooms';

type Msg = { type: string; roomId?: string; role?: 'host' | 'guest'; [k: string]: unknown };

function send(ws: WebSocket, data: unknown) {
  ws.send(JSON.stringify(data));
}

export function onMessage(ws: WebSocket, raw: string) {
  let msg: Msg;
  try { msg = JSON.parse(raw) as Msg; } catch { return; }

  if (msg.type === 'join') {
    const { roomId, role } = msg;
    if (!roomId || (role !== 'host' && role !== 'guest')) return;

    const result = join(roomId, role, ws);
    if (result === 'full') {
      send(ws, { type: 'room-full' });
      return;
    }

    const peer = getPeer(ws);
    if (role === 'guest' && peer) {
      send(ws, { type: 'room-ready' });
      send(peer, { type: 'peer-joined' });
    }
    return;
  }

  // All other messages are forwarded to the peer
  const peer = getPeer(ws);
  if (peer) send(peer, msg);
}

export function onClose(ws: WebSocket) {
  leave(ws);
}
