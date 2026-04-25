import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { WebSocket } from 'ws';
import { server } from './app';
import { MAX_PEERS_PER_ROOM } from './config';

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

  test('second host attempt rejected with room-full', async () => {
    const host1 = await connect();
    const host2 = await connect();
    await joinRoom(host1, 'room-c', 'host');

    const reject = nextMsg(host2);
    send(host2, { type: 'join', roomId: 'room-c', role: 'host' });
    expect((await reject).type).toBe('room-full');

    host1.close();
    host2.close();
  });

  test(`room rejects beyond ${MAX_PEERS_PER_ROOM} peers`, async () => {
    const host = await connect();
    await joinRoom(host, 'room-d', 'host');
    const guests: WebSocket[] = [];

    for (let i = 0; i < MAX_PEERS_PER_ROOM - 1; i++) {
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
