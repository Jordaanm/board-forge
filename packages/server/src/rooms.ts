import type { WebSocket } from 'ws';
import { maxRoomPeers } from './config';
import { RoomMetadata } from './RoomMetadata';

export type Role = 'host' | 'guest';

export interface Member {
  peerId:      string;
  role:        Role;
  ws:          WebSocket;
  displayName: string;
  ipHash:      string;
}

interface Room {
  hostId:   string | null;
  members:  Map<string, Member>;
  metadata: RoomMetadata;
}

export interface JoinResult {
  peerId:     string;
  hostId:     string | null;
  otherPeers: { peerId: string; role: Role; displayName: string }[];
  roomName:   string;
}

const rooms        = new Map<string, Room>();
const clientLookup = new Map<WebSocket, { roomId: string; peerId: string }>();
let totalRoomsCreated = 0;

export function join(roomId: string, role: Role, ws: WebSocket, displayName: string, ip: string): JoinResult | 'full' {
  let room = rooms.get(roomId);
  if (!room) {
    room = { hostId: null, members: new Map(), metadata: new RoomMetadata(displayName) };
    rooms.set(roomId, room);
    totalRoomsCreated++;
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
  const ipHash = room.metadata.hashIp(ip);
  room.members.set(peerId, { peerId, role, ws, displayName, ipHash });
  if (role === 'host') room.hostId = peerId;
  clientLookup.set(ws, { roomId, peerId });

  const otherPeers = Array.from(room.members.values())
    .filter(m => m.peerId !== peerId)
    .map(m => ({ peerId: m.peerId, role: m.role, displayName: m.displayName }));

  return { peerId, hostId: room.hostId, otherPeers, roomName: room.metadata.getName() };
}

export function getRoomMetadata(roomId: string): RoomMetadata | null {
  return rooms.get(roomId)?.metadata ?? null;
}

export function getHostId(roomId: string): string | null {
  return rooms.get(roomId)?.hostId ?? null;
}

export function getMember(roomId: string, peerId: string): Member | null {
  return rooms.get(roomId)?.members.get(peerId) ?? null;
}

export function getRoomMembers(roomId: string): Member[] {
  const room = rooms.get(roomId);
  return room ? Array.from(room.members.values()) : [];
}

export interface RoomInfo {
  roomId:      string;
  occupancy:   number;
  capacity:    number;
  name:        string;
  hasPassword: boolean;
}

export function listRooms(): RoomInfo[] {
  return Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    occupancy:   room.members.size,
    capacity:    maxRoomPeers,
    name:        room.metadata.getName(),
    hasPassword: room.metadata.hasPassword(),
  }));
}

export function getTotalRoomsCreated(): number {
  return totalRoomsCreated;
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
