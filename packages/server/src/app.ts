import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { onMessage, onClose } from './signaling';
import { getIceServers } from './config';
import { listRooms } from './rooms';

const app = express();

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ice-config', (_req, res) => {
  res.json({ iceServers: getIceServers() });
});

app.get('/rooms', (_req, res) => {
  res.json({ rooms: listRooms() });
});

export const server = createServer(app);

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (data) => onMessage(ws, data.toString()));
  ws.on('close', () => onClose(ws));
});
