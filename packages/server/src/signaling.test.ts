import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { server } from './app';
import { maxRoomPeers } from './config';

const PORT = 3099;
const WS = `ws://localhost:${PORT}`;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMsg(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
  });
}

// Drains intermediate messages until one with msg.type === expected arrives.
// Useful when several messages may queue up on a socket (e.g. host receives
// peer-joined and bansUpdated in close succession).
function waitFor(ws: WebSocket, expected: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMsg = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === expected) {
        ws.off('message', onMsg);
        resolve(msg);
      }
    };
    ws.on('message', onMsg);
  });
}

// Collects every incoming message on a ws into a list until stop() is
// called. Use in negative assertions ("the host received no bansUpdated").
function collectMessages(ws: WebSocket) {
  const messages: Record<string, unknown>[] = [];
  const onMsg = (data: Buffer) => {
    messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
  };
  ws.on('message', onMsg);
  return {
    types: () => messages.map(m => m.type as string),
    stop:  () => ws.off('message', onMsg),
  };
}

function send(ws: WebSocket, data: unknown) {
  ws.send(JSON.stringify(data));
}

async function joinRoom(ws: WebSocket, roomId: string, role: 'host' | 'guest', displayName = 'Player', password?: string) {
  const joined = nextMsg(ws);
  send(ws, { type: 'join', roomId, role, displayName, password });
  return joined;
}

beforeAll(() => new Promise<void>((r) => server.listen(PORT, r)));
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('room join', () => {
  test('host receives joined with own peerId and empty otherPeers', async () => {
    const host = await connect();
    const msg = await joinRoom(host, 'room-a', 'host');

    expect(msg.type).toBe('joined');
    expect(msg.role).toBe('host');
    expect(typeof msg.peerId).toBe('string');
    expect(msg.hostId).toBe(msg.peerId);
    expect(msg.otherPeers).toEqual([]);

    host.close();
  });

  test('guest joining gets host in otherPeers; host gets peer-joined', async () => {
    const host  = await connect();
    const guest = await connect();
    const hostJoined = await joinRoom(host, 'room-b', 'host');
    const hostId = hostJoined.peerId as string;

    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-b', 'guest');

    expect(guestJoined.role).toBe('guest');
    expect(guestJoined.hostId).toBe(hostId);
    expect(guestJoined.otherPeers).toEqual([{ peerId: hostId, role: 'host', displayName: 'Player' }]);

    const pj = await peerJoined;
    expect(pj.type).toBe('peer-joined');
    expect(pj.peerId).toBe(guestJoined.peerId);
    expect(pj.role).toBe('guest');

    host.close();
    guest.close();
  });

  test('second host attempt evicts existing host and takes over', async () => {
    const host1 = await connect();
    const host2 = await connect();
    const host1Joined = await joinRoom(host1, 'room-c', 'host');
    const host1Id = host1Joined.peerId as string;

    const host1Closed = new Promise<void>((r) => host1.once('close', () => r()));

    const host2Joined = await joinRoom(host2, 'room-c', 'host');
    expect(host2Joined.type).toBe('joined');
    expect(host2Joined.role).toBe('host');
    expect(host2Joined.peerId).not.toBe(host1Id);
    expect(host2Joined.hostId).toBe(host2Joined.peerId);

    // Old host's WS should be closed by the server.
    await host1Closed;

    host2.close();
  });

  test(`room rejects beyond ${maxRoomPeers} peers`, async () => {
    const host = await connect();
    await joinRoom(host, 'room-d', 'host');
    const guests: WebSocket[] = [];

    for (let i = 0; i < maxRoomPeers - 1; i++) {
      const g = await connect();
      // Drain peer-joined notifications on host so they don't pile up.
      host.once('message', () => {});
      await joinRoom(g, 'room-d', 'guest');
      guests.push(g);
    }

    const overflow = await connect();
    const rejected = nextMsg(overflow);
    send(overflow, { type: 'join', roomId: 'room-d', role: 'guest' });
    expect((await rejected).type).toBe('room-full');

    host.close();
    overflow.close();
    for (const g of guests) g.close();
  });

  test('over-cap join is rejected with reason room-full and not added to room', async () => {
    const host = await connect();
    await joinRoom(host, 'room-cap', 'host');
    const guests: WebSocket[] = [];

    for (let i = 0; i < maxRoomPeers - 1; i++) {
      const g = await connect();
      // Await each peer-joined synchronously — `host.once(...)` would stack
      // listeners across iterations and let in-flight peer-joineds leak past
      // the loop, racing against the hostNotified assertion below.
      const peerJoined = nextMsg(host);
      await joinRoom(g, 'room-cap', 'guest');
      await peerJoined;
      guests.push(g);
    }

    // Host must NOT receive a peer-joined for the overflow attempt.
    let hostNotified = false;
    host.once('message', () => { hostNotified = true; });

    const overflow = await connect();
    const rejected = nextMsg(overflow);
    send(overflow, { type: 'join', roomId: 'room-cap', role: 'guest' });
    const msg = await rejected;
    expect(msg.type).toBe('room-full');

    await new Promise((r) => setTimeout(r, 50));
    expect(hostNotified).toBe(false);

    host.close();
    overflow.close();
    for (const g of guests) g.close();
  });
});

describe('room name', () => {
  test('joined payload includes default room name derived from host display name', async () => {
    const host = await connect();
    const msg = await joinRoom(host, 'room-name-default', 'host', 'Alice');
    expect((msg.roomSettings as { name: string }).name).toBe("Alice's room");
    host.close();
  });

  test('host setRoomName broadcasts roomSettingsUpdated to all members', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-rename', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    await joinRoom(guest, 'room-rename', 'guest', 'Bob');
    await peerJoined;

    const hostUpdate  = nextMsg(host);
    const guestUpdate = nextMsg(guest);
    send(host, { type: 'setRoomName', name: 'D&D night' });
    const fromHost  = await hostUpdate;
    const fromGuest = await guestUpdate;
    expect(fromHost.type).toBe('roomSettingsUpdated');
    expect(fromHost.name).toBe('D&D night');
    expect(fromGuest.type).toBe('roomSettingsUpdated');
    expect(fromGuest.name).toBe('D&D night');

    host.close();
    guest.close();
  });

  test('empty / whitespace setRoomName reverts to the default', async () => {
    const host = await connect();
    await joinRoom(host, 'room-revert', 'host', 'Alice');

    const u1 = nextMsg(host);
    send(host, { type: 'setRoomName', name: 'Custom' });
    expect((await u1).name).toBe('Custom');

    const u2 = nextMsg(host);
    send(host, { type: 'setRoomName', name: '   ' });
    expect((await u2).name).toBe("Alice's room");

    host.close();
  });

  test('guest setRoomName is rejected — no broadcast', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-guard', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    await joinRoom(guest, 'room-guard', 'guest', 'Bob');
    await peerJoined;

    let received = false;
    const onAny = () => { received = true; };
    host.once('message', onAny);
    guest.once('message', onAny);

    send(guest, { type: 'setRoomName', name: 'pwn' });
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toBe(false);

    host.removeListener('message', onAny);
    guest.removeListener('message', onAny);
    host.close();
    guest.close();
  });

  test('listRooms exposes the current room name', async () => {
    const host = await connect();
    await joinRoom(host, 'room-list', 'host', 'Alice');
    const u = nextMsg(host);
    send(host, { type: 'setRoomName', name: 'Catan' });
    await u;

    const res = await fetch(`http://localhost:${PORT}/rooms`);
    const body = await res.json() as { rooms: { roomId: string; name: string }[] };
    const found = body.rooms.find(r => r.roomId === 'room-list');
    expect(found?.name).toBe('Catan');

    host.close();
  });
});

describe('bans', () => {
  test('host joined payload includes empty bans list by default', async () => {
    const host = await connect();
    const msg = await joinRoom(host, 'room-ban-default', 'host', 'Alice');
    expect(msg.bans).toEqual([]);
    host.close();
  });

  test('guests do not receive the bans field in joined', async () => {
    const host  = await connect();
    await joinRoom(host, 'room-ban-private', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    const guest = await connect();
    const guestJoined = await joinRoom(guest, 'room-ban-private', 'guest', 'Bob');
    await peerJoined;
    expect(guestJoined.bans).toBeUndefined();
    host.close();
    guest.close();
  });

  test('banPeer records a ban and disconnects the target', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-ban-action', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-action', 'guest', 'Mallory');
    await peerJoined;
    const guestPeerId = guestJoined.peerId as string;

    const guestClosed = new Promise<void>((r) => guest.once('close', () => r()));
    const bansUpdated = nextMsg(host);
    const peerLeft    = waitFor(host, 'peer-left');

    send(host, { type: 'banPeer', peerId: guestPeerId });
    const update = await bansUpdated;
    expect(update.type).toBe('bansUpdated');
    expect(update.bans).toEqual([
      expect.objectContaining({ name: 'Mallory' }),
    ]);
    expect((update.bans as { name: string }[])[0]).not.toHaveProperty('ipHash');

    await guestClosed;
    const left = await peerLeft;
    expect(left.peerId).toBe(guestPeerId);

    host.close();
  });

  test('banned name cannot rejoin under a new peer-id', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-ban-rename', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-rename', 'guest', 'Mallory');
    await peerJoined;
    const guestPeerId = guestJoined.peerId as string;

    const bansUpdated = nextMsg(host);
    void waitFor(host, 'peer-left');
    send(host, { type: 'banPeer', peerId: guestPeerId });
    await bansUpdated;

    const retry = await connect();
    const rejected = await joinRoom(retry, 'room-ban-rename', 'guest', 'Mallory');
    expect(rejected.type).toBe('joinRejected');
    expect(rejected.reason).toBe('banned');

    host.close();
    retry.close();
  });

  test('banned ip still rejected after renaming (ipHash match)', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-ban-ip', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-ip', 'guest', 'Mallory');
    await peerJoined;
    const guestPeerId = guestJoined.peerId as string;

    const bansUpdated = nextMsg(host);
    void waitFor(host, 'peer-left');
    send(host, { type: 'banPeer', peerId: guestPeerId });
    await bansUpdated;

    const retry = await connect();
    const rejected = await joinRoom(retry, 'room-ban-ip', 'guest', 'NotMallory');
    expect(rejected.type).toBe('joinRejected');
    expect(rejected.reason).toBe('banned');

    host.close();
    retry.close();
  });

  test('ban check runs before password check', async () => {
    const host = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-ban-precedence', 'host', 'Alice');

    const settingsUpdated = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'pw' });
    await settingsUpdated;

    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-precedence', 'guest', 'Mallory', 'pw');
    await peerJoined;
    const guestPeerId = guestJoined.peerId as string;

    const bansUpdated = nextMsg(host);
    void waitFor(host, 'peer-left');
    send(host, { type: 'banPeer', peerId: guestPeerId });
    await bansUpdated;

    const retry = await connect();
    // Correct password — but the user is banned by ipHash. Expect the
    // truthful `banned` verdict, not `wrongPassword`.
    const rejected = await joinRoom(retry, 'room-ban-precedence', 'guest', 'Different', 'pw');
    expect(rejected.reason).toBe('banned');

    host.close();
    retry.close();
  });

  test('unban removes the entry and lets the user back in', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-ban-unban', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-unban', 'guest', 'Mallory');
    await peerJoined;
    const guestPeerId = guestJoined.peerId as string;

    const bansUpdated = nextMsg(host);
    void waitFor(host, 'peer-left');
    send(host, { type: 'banPeer', peerId: guestPeerId });
    await bansUpdated;

    const cleared = nextMsg(host);
    send(host, { type: 'unban', name: 'Mallory' });
    const after = await cleared;
    expect(after.type).toBe('bansUpdated');
    expect(after.bans).toEqual([]);

    const retry = await connect();
    const retryPeer = nextMsg(host);
    const admitted = await joinRoom(retry, 'room-ban-unban', 'guest', 'Mallory');
    expect(admitted.type).toBe('joined');
    await retryPeer;

    host.close();
    retry.close();
  });

  test('guest banPeer is ignored — host receives no bansUpdated, target stays open', async () => {
    const host      = await connect();
    const guest     = await connect();
    const evilGuest = await connect();
    await joinRoom(host, 'room-ban-guard', 'host', 'Alice');
    const peer1 = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-guard', 'guest', 'Bob');
    await peer1;
    const peer2 = nextMsg(host);
    await joinRoom(evilGuest, 'room-ban-guard', 'guest', 'Evil');
    await peer2;

    const hostMessages = collectMessages(host);

    send(evilGuest, { type: 'banPeer', peerId: guestJoined.peerId as string });
    await new Promise((r) => setTimeout(r, 100));

    expect(hostMessages.types()).not.toContain('bansUpdated');
    expect(hostMessages.types()).not.toContain('peer-left');
    expect(guest.readyState).toBe(WebSocket.OPEN);

    hostMessages.stop();
    host.close();
    guest.close();
    evilGuest.close();
  });

  test('guest unban is ignored — host receives no bansUpdated', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-ban-guard-unban', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-ban-guard-unban', 'guest', 'Mallory');
    await peerJoined;

    // Real ban to seed the metadata with an entry.
    const bansUpdated = waitFor(host, 'bansUpdated');
    send(host, { type: 'banPeer', peerId: guestJoined.peerId as string });
    await bansUpdated;

    // Now connect a separate guest who will try to unban without host rights.
    // No need to wait for the banned guest's peer-left first; collectMessages
    // below captures every host-bound frame from this point so the assertion
    // can simply check that no bansUpdated appears.
    const evil = await connect();
    await joinRoom(evil, 'room-ban-guard-unban', 'guest', 'Evil');

    const hostMessages = collectMessages(host);

    send(evil, { type: 'unban', name: 'Mallory' });
    await new Promise((r) => setTimeout(r, 150));

    expect(hostMessages.types()).not.toContain('bansUpdated');

    hostMessages.stop();
    host.close();
    evil.close();
  });

  test('host cannot ban themselves', async () => {
    const host = await connect();
    const hostJoined = await joinRoom(host, 'room-ban-self', 'host', 'Alice');

    const hostMessages = collectMessages(host);
    send(host, { type: 'banPeer', peerId: hostJoined.peerId as string });
    await new Promise((r) => setTimeout(r, 100));
    expect(hostMessages.types()).not.toContain('bansUpdated');

    hostMessages.stop();
    host.close();
  });
});

describe('room password', () => {
  test('joined.roomSettings reports hasPassword=false by default', async () => {
    const host = await connect();
    const msg = await joinRoom(host, 'room-pw-default', 'host', 'Alice');
    expect((msg.roomSettings as { hasPassword: boolean }).hasPassword).toBe(false);
    host.close();
  });

  test('setRoomPassword broadcasts hasPassword=true', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-pw-set', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    await joinRoom(guest, 'room-pw-set', 'guest', 'Bob');
    await peerJoined;

    const hostUpdate  = nextMsg(host);
    const guestUpdate = nextMsg(guest);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    expect((await hostUpdate).hasPassword).toBe(true);
    expect((await guestUpdate).hasPassword).toBe(true);

    host.close();
    guest.close();
  });

  test('correct password admits a new guest', async () => {
    const host = await connect();
    await joinRoom(host, 'room-pw-admit', 'host', 'Alice');
    const u = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    await u;

    const guest = await connect();
    const peerJoined = nextMsg(host);
    const joined = await joinRoom(guest, 'room-pw-admit', 'guest', 'Bob', 'hunter2');
    expect(joined.type).toBe('joined');
    await peerJoined;

    host.close();
    guest.close();
  });

  test('wrong password yields joinRejected with reason wrongPassword', async () => {
    const host = await connect();
    await joinRoom(host, 'room-pw-wrong', 'host', 'Alice');
    const u = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    await u;

    const guest = await connect();
    const rejected = await joinRoom(guest, 'room-pw-wrong', 'guest', 'Bob', 'nope');
    expect(rejected.type).toBe('joinRejected');
    expect(rejected.reason).toBe('wrongPassword');

    host.close();
    guest.close();
  });

  test('missing password on a locked room is rejected', async () => {
    const host = await connect();
    await joinRoom(host, 'room-pw-missing', 'host', 'Alice');
    const u = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    await u;

    const guest = await connect();
    const rejected = await joinRoom(guest, 'room-pw-missing', 'guest', 'Bob');
    expect(rejected.type).toBe('joinRejected');
    expect(rejected.reason).toBe('wrongPassword');

    host.close();
    guest.close();
  });

  test('cleared password reopens the room', async () => {
    const host = await connect();
    await joinRoom(host, 'room-pw-clear', 'host', 'Alice');
    const u1 = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    await u1;
    const u2 = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: null });
    expect((await u2).hasPassword).toBe(false);

    const guest = await connect();
    const peerJoined = nextMsg(host);
    const joined = await joinRoom(guest, 'room-pw-clear', 'guest', 'Bob');
    expect(joined.type).toBe('joined');
    await peerJoined;

    host.close();
    guest.close();
  });

  test('existing guests are not disconnected when host sets a password', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-pw-stay', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    await joinRoom(guest, 'room-pw-stay', 'guest', 'Bob');
    await peerJoined;

    let guestClosed = false;
    guest.once('close', () => { guestClosed = true; });

    const u = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    await u;

    // Drain the guest's roomSettingsUpdated message.
    await nextMsg(guest);
    await new Promise((r) => setTimeout(r, 50));
    expect(guestClosed).toBe(false);

    host.close();
    guest.close();
  });

  test('guest setRoomPassword is ignored — no broadcast', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-pw-guard', 'host', 'Alice');
    const peerJoined = nextMsg(host);
    await joinRoom(guest, 'room-pw-guard', 'guest', 'Bob');
    await peerJoined;

    const hostMessages = collectMessages(host);

    send(guest, { type: 'setRoomPassword', password: 'pwn' });
    await new Promise((r) => setTimeout(r, 100));
    expect(hostMessages.types()).not.toContain('roomSettingsUpdated');

    hostMessages.stop();
    host.close();
    guest.close();
  });

  test('listRooms exposes hasPassword', async () => {
    const host = await connect();
    await joinRoom(host, 'room-pw-list', 'host', 'Alice');
    const u = nextMsg(host);
    send(host, { type: 'setRoomPassword', password: 'hunter2' });
    await u;

    const res = await fetch(`http://localhost:${PORT}/rooms`);
    const body = await res.json() as { rooms: { roomId: string; hasPassword: boolean }[] };
    const found = body.rooms.find(r => r.roomId === 'room-pw-list');
    expect(found?.hasPassword).toBe(true);

    host.close();
  });
});

describe('display name', () => {
  test('joined echoes the supplied display name', async () => {
    const host = await connect();
    const msg = await joinRoom(host, 'room-name-a', 'host', 'Alice');
    expect(msg.displayName).toBe('Alice');
    host.close();
  });

  test('display name is included in otherPeers and peer-joined', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-name-b', 'host', 'Alice');

    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-name-b', 'guest', 'Bob');

    expect((guestJoined.otherPeers as { displayName: string }[])[0].displayName).toBe('Alice');
    const pj = await peerJoined;
    expect(pj.displayName).toBe('Bob');

    host.close();
    guest.close();
  });

  test('whitespace-only and oversize names are sanitised', async () => {
    const host = await connect();
    const msg = await joinRoom(host, 'room-name-c', 'host', '   ');
    expect(msg.displayName).toBe('');

    const longHost = await connect();
    const longMsg = await joinRoom(longHost, 'room-name-d', 'host', 'x'.repeat(80));
    expect(typeof longMsg.displayName).toBe('string');
    expect((longMsg.displayName as string).length).toBe(40);

    host.close();
    longHost.close();
  });
});

describe('signal forwarding', () => {
  test('offer is forwarded to targetPeerId, stamped with fromPeerId', async () => {
    const host  = await connect();
    const guest = await connect();
    const hostJoined  = await joinRoom(host, 'room-e', 'host');
    const hostId      = hostJoined.peerId as string;
    const peerJoined  = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-e', 'guest');
    const guestId     = guestJoined.peerId as string;
    await peerJoined;

    const offerReceived = nextMsg(guest);
    send(host, { type: 'offer', targetPeerId: guestId, sdp: { sdp: 'fake' } });
    const offer = await offerReceived;
    expect(offer.type).toBe('offer');
    expect(offer.fromPeerId).toBe(hostId);

    host.close();
    guest.close();
  });

  test('signal to unknown target is dropped', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-f', 'host');
    const peerJoined = nextMsg(host);
    await joinRoom(guest, 'room-f', 'guest');
    await peerJoined;

    let received = false;
    guest.once('message', () => { received = true; });
    send(host, { type: 'offer', targetPeerId: 'bogus', sdp: { sdp: 'x' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toBe(false);

    host.close();
    guest.close();
  });
});

describe('peer-left', () => {
  test('host is notified when guest disconnects', async () => {
    const host  = await connect();
    const guest = await connect();
    await joinRoom(host, 'room-g', 'host');
    const peerJoined = nextMsg(host);
    const guestJoined = await joinRoom(guest, 'room-g', 'guest');
    await peerJoined;

    const peerLeft = nextMsg(host);
    guest.close();
    const left = await peerLeft;
    expect(left.type).toBe('peer-left');
    expect(left.peerId).toBe(guestJoined.peerId);

    host.close();
  });
});
