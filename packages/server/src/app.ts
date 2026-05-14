import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { onMessage, onClose } from './signaling';
import { getIceServers } from './config';
import { listRooms, getTotalRoomsCreated } from './rooms';

const app = express();

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

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

export const server = createServer(app);

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (data) => onMessage(ws, data.toString()));
  ws.on('close', () => onClose(ws));
});
