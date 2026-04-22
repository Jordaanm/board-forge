import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { WebSocket } from 'ws';
import { server } from './app';

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

beforeAll(() => new Promise<void>((r) => server.listen(PORT, r)));
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('room join', () => {
  test('host and guest both get notified when peer connects', async () => {
    const host = await connect();
    const guest = await connect();

    send(host, { type: 'join', roomId: 'room-a', role: 'host' });

    const peerJoined = nextMsg(host);
    const roomReady = nextMsg(guest);
    send(guest, { type: 'join', roomId: 'room-a', role: 'guest' });

    const [h, g] = await Promise.all([peerJoined, roomReady]);
    expect(h.type).toBe('peer-joined');
    expect(g.type).toBe('room-ready');

    host.close();
    guest.close();
  });

  test('third peer joining a full room receives room-full', async () => {
    const host = await connect();
    const guest = await connect();
    const third = await connect();

    send(host, { type: 'join', roomId: 'room-b', role: 'host' });

    // Wait for guest to join and get room-ready before adding third
    const roomReady = nextMsg(guest);
    send(guest, { type: 'join', roomId: 'room-b', role: 'guest' });
    await roomReady;

    const fullMsg = nextMsg(third);
    send(third, { type: 'join', roomId: 'room-b', role: 'guest' });
    const msg = await fullMsg;
    expect(msg.type).toBe('room-full');

    host.close();
    guest.close();
    third.close();
  });

  test('signaling messages are forwarded to the peer', async () => {
    const host = await connect();
    const guest = await connect();

    // Register listeners before sending so in-flight messages are captured
    const peerJoined = nextMsg(host);
    const roomReady = nextMsg(guest);
    send(host, { type: 'join', roomId: 'room-c', role: 'host' });
    send(guest, { type: 'join', roomId: 'room-c', role: 'guest' });
    await Promise.all([peerJoined, roomReady]);

    const offerReceived = nextMsg(guest);
    send(host, { type: 'offer', sdp: { type: 'offer', sdp: 'fake-sdp' } });
    const msg = await offerReceived;
    expect(msg.type).toBe('offer');

    host.close();
    guest.close();
  });
});
