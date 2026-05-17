import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { onMessage, onClose, setClientIp } from './signaling';
import { getIceServers } from './config';
import { listRooms, getTotalRoomsCreated } from './rooms';
import { handleDiscordExchange } from './discordOAuth';

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '8kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ice-config', async (_req, res) => {
  try {
    const iceServers = await getIceServers();
    res.json({ iceServers });
  } catch (err) {
    console.error('[ice-config]', err);
    res.status(500).json({ error: 'ice-config failed' });
  }
});

app.get('/rooms', (_req, res) => {
  res.json({ rooms: listRooms(), totalRoomsCreated: getTotalRoomsCreated() });
});

app.post('/oauth/discord/exchange', handleDiscordExchange);

export const server = createServer(app);

const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const xff   = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const first = xff.split(',')[0]?.trim();
  const ip    = first || req.socket.remoteAddress || '';
  setClientIp(ws, ip);
  ws.on('message', (data) => onMessage(ws, data.toString()));
  ws.on('close', () => onClose(ws));
});
