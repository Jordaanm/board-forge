import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { onMessage, onClose } from './signaling';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export const server = createServer(app);

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (data) => onMessage(ws, data.toString()));
  ws.on('close', () => onClose(ws));
});
