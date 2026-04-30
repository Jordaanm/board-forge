import type { WebSocket } from 'ws';
import { maxRoomPeers } from './config';

export type Role = 'host' | 'guest';

export interface Member {
  peerId: string;
  role:   Role;
  ws:     WebSocket;
}

interface Room {
  hostId:  string | null;
  members: Map<string, Member>;
}

export interface JoinResult {
  peerId:     string;
  hostId:     string | null;
  otherPeers: { peerId: string; role: Role }[];
}

const rooms        = new Map<string, Room>();
const clientLookup = new Map<WebSocket, { roomId: string; peerId: string }>();

export function join(roomId: string, role: Role, ws: WebSocket): JoinResult | 'full' {
  let room = rooms.get(roomId);
  if (!room) {
    room = { hostId: null, members: new Map() };
    rooms.set(roomId, room);
  }

  // Host re-claim: evict any stale host whose WS hasn't been cleaned up yet
  // (covers React StrictMode rapid mount/cleanup/mount, page reload, reconnect).
  if (role === 'host' && room.hostId) {
    const stale = room.members.get(room.hostId);
    if (stale) {
      try { stale.ws.close(); } catch { /* ignore */ }
      clientLookup.delete(stale.ws);
      room.members.delete(room.hostId);
    }
    room.hostId = null;
  }

  if (room.members.size >= maxRoomPeers) return 'full';

  const peerId = crypto.randomUUID();
  room.members.set(peerId, { peerId, role, ws });
  if (role === 'host') room.hostId = peerId;
  clientLookup.set(ws, { roomId, peerId });

  const otherPeers = Array.from(room.members.values())
    .filter(m => m.peerId !== peerId)
    .map(m => ({ peerId: m.peerId, role: m.role }));

  return { peerId, hostId: room.hostId, otherPeers };
}

export function getMember(roomId: string, peerId: string): Member | null {
  return rooms.get(roomId)?.members.get(peerId) ?? null;
}

export function getRoomMembers(roomId: string): Member[] {
  const room = rooms.get(roomId);
  return room ? Array.from(room.members.values()) : [];
}

export function lookup(ws: WebSocket): { roomId: string; peerId: string } | null {
  return clientLookup.get(ws) ?? null;
}

export function leave(ws: WebSocket): { roomId: string; peerId: string; role: Role } | null {
  const info = clientLookup.get(ws);
  if (!info) return null;
  clientLookup.delete(ws);

  const room = rooms.get(info.roomId);
  if (!room) return null;
  const member = room.members.get(info.peerId);
  if (!member) return null;

  room.members.delete(info.peerId);
  if (room.hostId === info.peerId) room.hostId = null;
  if (room.members.size === 0) rooms.delete(info.roomId);

  return { roomId: info.roomId, peerId: info.peerId, role: member.role };
}
