import type { WebSocket } from 'ws';
import { join, leave, lookup, getMember, getRoomMembers, getRoomMetadata, getHostId, type Role } from './rooms';

// IP attached at WS open in app.ts. Stored out-of-band so the ws type stays
// stock and join() / ban look-ups can resolve it deterministically.
const clientIps = new WeakMap<WebSocket, string>();

export function setClientIp(ws: WebSocket, ip: string) {
  clientIps.set(ws, ip);
}

function getClientIp(ws: WebSocket): string {
  return clientIps.get(ws) ?? '';
}

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

  if (msg.type === 'banPeer') {
    handleBanPeer(ws, msg);
    return;
  }

  if (msg.type === 'unban') {
    handleUnban(ws, msg);
    return;
  }

  if (FORWARDABLE.has(msg.type)) {
    handleForward(ws, msg);
  }
}

function handleJoin(ws: WebSocket, msg: Msg) {
  const { roomId, role } = msg;
  if (!roomId || (role !== 'host' && role !== 'guest')) return;

  const displayName      = sanitiseDisplayName(msg.displayName);
  const suppliedPassword = typeof msg.password === 'string' ? msg.password : undefined;
  const ip               = getClientIp(ws);

  // Ban + password gate. Hosts bypass (they own the room); guests run
  // through RoomMetadata.checkJoin, which checks bans (name OR ipHash)
  // before password. A non-existent room can't be locked or have bans, so
  // first-joiners are unaffected.
  if (role === 'guest') {
    const existing = getRoomMetadata(roomId);
    if (existing) {
      const ipHash  = existing.hashIp(ip);
      const verdict = existing.checkJoin(displayName, ipHash, suppliedPassword);
      if (verdict !== 'ok') {
        send(ws, { type: 'joinRejected', reason: verdict });
        return;
      }
    }
  }

  const result = join(roomId, role, ws, displayName, ip);
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
    // Hosts get the ban list at join time so the Settings modal can render
    // it without an extra round-trip. Guests never see the list.
    bans:         role === 'host' ? (metadata?.getPublicBans() ?? []) : undefined,
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

function handleBanPeer(ws: WebSocket, msg: Msg) {
  const info = lookup(ws);
  if (!info) return;
  if (getHostId(info.roomId) !== info.peerId) return;

  const targetPeerId = typeof msg.peerId === 'string' ? msg.peerId : null;
  if (!targetPeerId || targetPeerId === info.peerId) return;

  const target = getMember(info.roomId, targetPeerId);
  if (!target) return;

  const metadata = getRoomMetadata(info.roomId);
  if (!metadata) return;

  metadata.addBan(target.displayName, target.ipHash);

  // Forcefully disconnect the banned peer. Closing the ws triggers onClose,
  // which removes them from the room and notifies other members via the
  // existing peer-left broadcast. Send the kick reason first so the client
  // can surface it before its ws layer reports the close.
  try { send(target.ws, { type: 'joinRejected', reason: 'banned' }); } catch { /* ignore */ }
  try { target.ws.close(); } catch { /* ignore */ }

  sendBansToHost(info.roomId, ws, metadata);
}

function handleUnban(ws: WebSocket, msg: Msg) {
  const info = lookup(ws);
  if (!info) return;
  if (getHostId(info.roomId) !== info.peerId) return;

  const name = typeof msg.name === 'string' ? msg.name : null;
  if (name === null) return;

  const metadata = getRoomMetadata(info.roomId);
  if (!metadata) return;

  if (!metadata.removeBan(name)) return;
  sendBansToHost(info.roomId, ws, metadata);
}

function sendBansToHost(roomId: string, hostWs: WebSocket, metadata: NonNullable<ReturnType<typeof getRoomMetadata>>) {
  // Ban list is host-only — never broadcast to all members.
  void roomId;
  send(hostWs, { type: 'bansUpdated', bans: metadata.getPublicBans() });
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
