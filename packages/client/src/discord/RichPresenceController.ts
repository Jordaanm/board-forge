// Local-Discord RPC controller. Walks the AUTHORIZE → exchange →
// AUTHENTICATE → SET_ACTIVITY handshake against the Discord desktop client
// over a localhost WebSocket. Silent no-op when the desktop client isn't
// running — never logs a connection failure, never throws into the room.
//
// Lifecycle:
//   start(input)  — opens the socket (tries ports 6463–6472), authorises,
//                   sends an initial SET_ACTIVITY.
//   update(input) — replaces the queued activity; flushes within ~15s.
//   stop()        — clears activity and closes the socket.
//
// A SET_ACTIVITY rate limit (~5/20s) sits inside the desktop client, so we
// throttle ourselves to once per 15s with trailing-edge delivery.

import { buildActivity, type PresenceInput } from './rpcPayload';
import { getApiUrl, getClientId } from './authConfig';

const RPC_PORT_START = 6463;
const RPC_PORT_END   = 6472;
const RPC_VERSION    = '1';
const RPC_SCOPES     = ['rpc.activities.write'];
const RPC_THROTTLE_MS = 15_000;

// Discord RPC opcodes (subset).
const OP_HANDSHAKE = 0;
const OP_FRAME     = 1;
const OP_CLOSE     = 2;
// const OP_PING      = 3;
// const OP_PONG      = 4;

interface RpcFrame {
  cmd:    string;
  evt?:   string;
  data?:  unknown;
  nonce?: string;
  args?:  unknown;
}

type State = 'idle' | 'connecting' | 'authorizing' | 'authenticating' | 'ready' | 'stopped';

export class RichPresenceController {
  private ws:        WebSocket | null = null;
  private state:     State            = 'idle';
  private pending:   PresenceInput | null = null;
  private lastSent:  number           = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private nonceSeq:  number           = 0;

  // Open the socket (best-effort) and publish an initial activity. If the
  // socket is already running for a previous room, stops first.
  start(input: PresenceInput): void {
    if (this.state !== 'idle' && this.state !== 'stopped') this.stop();
    this.state    = 'connecting';
    this.pending  = input;
    this.lastSent = 0;
    void this.tryConnect(RPC_PORT_START);
  }

  // Queue a new activity. The throttler decides whether to fire now or wait.
  update(input: PresenceInput): void {
    this.pending = input;
    if (this.state !== 'ready') return;
    this.maybeFlush();
  }

  stop(): void {
    if (this.state === 'idle' || this.state === 'stopped') {
      this.state = 'stopped';
      return;
    }
    if (this.ws !== null && this.state === 'ready') {
      // Best-effort clear — Discord shows nothing once the connection closes
      // either way, but SET_ACTIVITY null tidies things up explicitly.
      try {
        this.send({ cmd: 'SET_ACTIVITY', args: { pid: 0, activity: null }, nonce: this.nextNonce() });
      } catch { /* ignore */ }
    }
    this.cleanup();
    this.state = 'stopped';
  }

  private async tryConnect(port: number): Promise<void> {
    if (port > RPC_PORT_END) {
      // Exhausted the port range — Discord desktop isn't listening, or every
      // upgrade attempt was rejected (origin not allow-listed for the app).
      console.warn('[discord-rpc] no RPC port responded — Discord not running, or app RPC Origins missing this page\'s origin');
      this.cleanup();
      this.state = 'stopped';
      return;
    }
    const url = `ws://127.0.0.1:${port}/?v=${RPC_VERSION}&client_id=${encodeURIComponent(getClientId())}`;
    let ws: WebSocket;
    try {
      // No subprotocol — Discord's RPC server checks the `Origin` header
      // against the app's RPC Origins allowlist (configured in the dev
      // portal). The browser sets Origin automatically from the page URL,
      // so the page origin must be listed there for the upgrade to succeed.
      ws = new WebSocket(url);
    } catch (err) {
      console.warn('[discord-rpc] WebSocket ctor threw on port', port, err);
      void this.tryConnect(port + 1);
      return;
    }
    this.ws = ws;

    const onOpen   = () => {
      ws.removeEventListener('error', onError);
      this.onOpen();
    };
    const onError  = () => {
      ws.removeEventListener('open',  onOpen);
      ws.removeEventListener('close', onCloseEarly);
      this.ws = null;
      void this.tryConnect(port + 1);
    };
    const onCloseEarly = () => {
      ws.removeEventListener('open',  onOpen);
      ws.removeEventListener('error', onError);
      this.ws = null;
      void this.tryConnect(port + 1);
    };
    ws.addEventListener('open',  onOpen,       { once: true });
    ws.addEventListener('error', onError,      { once: true });
    ws.addEventListener('close', onCloseEarly, { once: true });
  }

  private onOpen(): void {
    if (this.ws === null) return;
    // Replace early-listeners with the long-running ones.
    this.ws.addEventListener('message', (e) => this.onMessage(e));
    this.ws.addEventListener('close',   () => this.onClose());
    this.ws.addEventListener('error',   () => this.onClose());
    // Discord expects the AUTHORIZE frame; READY is delivered automatically.
    this.state = 'authorizing';
    this.send({
      cmd:   'AUTHORIZE',
      args:  { client_id: getClientId(), scopes: RPC_SCOPES },
      nonce: this.nextNonce(),
    });
  }

  private onMessage(e: MessageEvent): void {
    let frame: RpcFrame;
    try {
      frame = JSON.parse(e.data as string) as RpcFrame;
    } catch { return; }

    if (frame.cmd === 'AUTHORIZE' && this.state === 'authorizing') {
      const data = frame.data as { code?: unknown } | undefined;
      const code = typeof data?.code === 'string' ? data.code : null;
      if (code === null) {
        console.warn('[discord-rpc] AUTHORIZE returned no code', frame);
        this.cleanup(); this.state = 'stopped'; return;
      }
      void this.exchangeAndAuthenticate(code);
      return;
    }

    if (frame.cmd === 'AUTHENTICATE' && this.state === 'authenticating') {
      this.state = 'ready';
      this.maybeFlush();
      return;
    }

    if (frame.cmd === 'DISPATCH' && frame.evt === 'ERROR') {
      console.warn('[discord-rpc] ERROR dispatch from Discord', frame);
      this.cleanup();
      this.state = 'stopped';
    }
  }

  private async exchangeAndAuthenticate(code: string): Promise<void> {
    let accessToken: string;
    try {
      const res = await fetch(`${getApiUrl()}/oauth/discord/exchange`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, flow: 'rpc' }),
      });
      if (!res.ok) {
        console.warn('[discord-rpc] RPC code exchange failed', res.status);
        this.cleanup(); this.state = 'stopped'; return;
      }
      const body = await res.json() as { access_token?: unknown };
      if (typeof body.access_token !== 'string') {
        console.warn('[discord-rpc] RPC code exchange returned no access_token', body);
        this.cleanup(); this.state = 'stopped'; return;
      }
      accessToken = body.access_token;
    } catch (err) {
      console.warn('[discord-rpc] RPC code exchange threw', err);
      this.cleanup(); this.state = 'stopped'; return;
    }
    if (this.ws === null) return;
    this.state = 'authenticating';
    this.send({
      cmd:   'AUTHENTICATE',
      args:  { access_token: accessToken },
      nonce: this.nextNonce(),
    });
  }

  private maybeFlush(): void {
    if (this.state !== 'ready' || this.pending === null) return;
    const now = Date.now();
    const wait = Math.max(0, this.lastSent + RPC_THROTTLE_MS - now);
    if (wait === 0) {
      this.flushNow();
      return;
    }
    if (this.flushTimer === null) {
      // Trailing-edge flush: schedule one timer; the latest `pending` wins.
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushNow();
      }, wait);
    }
  }

  private flushNow(): void {
    if (this.state !== 'ready' || this.pending === null) return;
    const activity = buildActivity(this.pending);
    this.send({ cmd: 'SET_ACTIVITY', args: { pid: 0, activity }, nonce: this.nextNonce() });
    this.lastSent = Date.now();
  }

  private send(frame: RpcFrame): void {
    if (this.ws === null) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch { /* ignore */ }
  }

  private onClose(): void {
    if (this.state === 'stopped') return;
    this.cleanup();
    this.state = 'stopped';
  }

  private cleanup(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.ws !== null) {
      try { this.ws.close(OP_CLOSE); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private nextNonce(): string {
    this.nonceSeq += 1;
    return `vt-${this.nonceSeq}`;
  }
}

// Silence the "unused constant" lint — the opcodes are kept here as
// documentation for the Discord RPC framing even when not all are sent.
void OP_HANDSHAKE; void OP_FRAME;
