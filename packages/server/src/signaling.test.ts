import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
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

function send(ws: WebSocket, data: unknown) {
  ws.send(JSON.stringify(data));
}

async function joinRoom(ws: WebSocket, roomId: string, role: 'host' | 'guest') {
  const joined = nextMsg(ws);
  send(ws, { type: 'join', roomId, role });
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
    expect(guestJoined.otherPeers).toEqual([{ peerId: hostId, role: 'host' }]);

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
      host.once('message', () => {});
      await joinRoom(g, 'room-cap', 'guest');
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
