import type { WebSocket } from 'ws';
import { join, leave, lookup, getMember, getRoomMembers, getRoomMetadata, getHostId, type Role } from './rooms';

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

  if (msg.type === 'setRoomName') {
    handleSetRoomName(ws, msg);
    return;
  }

  if (msg.type === 'setRoomPassword') {
    handleSetRoomPassword(ws, msg);
    return;
  }

  if (FORWARDABLE.has(msg.type)) {
    handleForward(ws, msg);
  }
}

function handleJoin(ws: WebSocket, msg: Msg) {
  const { roomId, role } = msg;
  if (!roomId || (role !== 'host' && role !== 'guest')) return;

  const displayName       = sanitiseDisplayName(msg.displayName);
  const suppliedPassword  = typeof msg.password === 'string' ? msg.password : undefined;

  // Password gate. Hosts bypass (they own the room); guests pass through
  // RoomMetadata.checkJoin. A non-existent room can't be locked, so first-
  // joiners are unaffected.
  if (role === 'guest') {
    const existing = getRoomMetadata(roomId);
    if (existing) {
      const verdict = existing.checkJoin(suppliedPassword);
      if (verdict !== 'ok') {
        send(ws, { type: 'joinRejected', reason: verdict });
        return;
      }
    }
  }

  const result = join(roomId, role, ws, displayName);
  if (result === 'full') {
    send(ws, { type: 'room-full' });
    return;
  }

  const metadata = getRoomMetadata(roomId);
  const roomSettings = {
    name:        result.roomName,
    hasPassword: metadata?.hasPassword() ?? false,
  };

  send(ws, {
    type:         'joined',
    peerId:       result.peerId,
    role,
    hostId:       result.hostId,
    displayName,
    otherPeers:   result.otherPeers,
    roomSettings,
  });

  // Notify existing members of the new peer.
  for (const other of result.otherPeers) {
    const member = getMember(roomId, other.peerId);
    if (member) send(member.ws, { type: 'peer-joined', peerId: result.peerId, role, displayName });
  }
}

function handleSetRoomName(ws: WebSocket, msg: Msg) {
  const info = lookup(ws);
  if (!info) return;
  if (getHostId(info.roomId) !== info.peerId) return;

  const metadata = getRoomMetadata(info.roomId);
  if (!metadata) return;

  const rawName = typeof msg.name === 'string' ? msg.name : '';
  metadata.setName(rawName);
  broadcastSettings(info.roomId, metadata);
}

function handleSetRoomPassword(ws: WebSocket, msg: Msg) {
  const info = lookup(ws);
  if (!info) return;
  if (getHostId(info.roomId) !== info.peerId) return;

  const metadata = getRoomMetadata(info.roomId);
  if (!metadata) return;

  const raw = typeof msg.password === 'string' ? msg.password : null;
  metadata.setPassword(raw);
  broadcastSettings(info.roomId, metadata);
}

function broadcastSettings(roomId: string, metadata: ReturnType<typeof getRoomMetadata> & object) {
  const payload = {
    type:        'roomSettingsUpdated',
    name:        metadata.getName(),
    hasPassword: metadata.hasPassword(),
  };
  for (const m of getRoomMembers(roomId)) {
    send(m.ws, payload);
  }
}

const MAX_DISPLAY_NAME_LENGTH = 40;

function sanitiseDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  return Array.from(trimmed).slice(0, MAX_DISPLAY_NAME_LENGTH).join('');
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
