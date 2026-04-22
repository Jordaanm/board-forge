import type { WebSocket } from 'ws';

interface Room {
  host: WebSocket | null;
  guest: WebSocket | null;
}

const rooms = new Map<string, Room>();
const clientRoom = new Map<WebSocket, { roomId: string; role: 'host' | 'guest' }>();

export function join(
  roomId: string,
  role: 'host' | 'guest',
  ws: WebSocket
): 'ok' | 'full' {
  let room = rooms.get(roomId);
  if (!room) {
    room = { host: null, guest: null };
    rooms.set(roomId, room);
  }

  if (role === 'host') {
    room.host = ws;
  } else {
    if (room.guest) return 'full';
    room.guest = ws;
  }

  clientRoom.set(ws, { roomId, role });
  return 'ok';
}

export function getPeer(ws: WebSocket): WebSocket | null {
  const info = clientRoom.get(ws);
  if (!info) return null;
  const room = rooms.get(info.roomId);
  if (!room) return null;
  return info.role === 'host' ? room.guest : room.host;
}

export function leave(ws: WebSocket) {
  const info = clientRoom.get(ws);
  if (!info) return;
  clientRoom.delete(ws);
  const room = rooms.get(info.roomId);
  if (!room) return;
  if (info.role === 'host') room.host = null;
  else room.guest = null;
  if (!room.host && !room.guest) rooms.delete(info.roomId);
}
