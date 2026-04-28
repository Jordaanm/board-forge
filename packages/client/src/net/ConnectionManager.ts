type Status = 'connecting' | 'connected' | 'disconnected' | 'room-full';
type Role   = 'host' | 'guest';

type MsgHandler           = (peerId: string, msg: unknown) => void;
type StatusHandler        = (s: Status) => void;
type PeerLeftHandler      = (peerId: string) => void;
type PeerConnectedHandler = (peerId: string) => void;
type JoinedHandler        = (peerId: string, hostPeerId: string | null) => void;

type SignalingMsg = { type: string; [k: string]: unknown };

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

interface PeerEntry {
  pc:      RTCPeerConnection;
  channel: RTCDataChannel | null;
  open:    boolean;
}

// Convert ws://host or wss://host into http(s)://host so we can hit /ice-config.
function httpFromWs(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http');
}

async function fetchIceServers(signalingUrl: string): Promise<RTCIceServer[]> {
  try {
    const res  = await fetch(`${httpFromWs(signalingUrl)}/ice-config`);
    if (!res.ok) throw new Error(`ice-config status ${res.status}`);
    const body = await res.json() as { iceServers?: RTCIceServer[] };
    if (Array.isArray(body.iceServers) && body.iceServers.length) return body.iceServers;
  } catch (err) {
    console.warn('[ICE] failed to fetch /ice-config, falling back to default STUN', err);
  }
  return FALLBACK_ICE_SERVERS;
}

export class ConnectionManager {
  private ws:         WebSocket | null = null;
  private peerId:     string | null = null;
  private role:       Role | null = null;
  private hostId:     string | null = null;
  private peers       = new Map<string, PeerEntry>();
  private iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;

  constructor(
    private readonly onMsg:           MsgHandler,
    private readonly onStatus:        StatusHandler,
    private readonly onPeerLeft:      PeerLeftHandler      = () => {},
    private readonly onPeerConnected: PeerConnectedHandler = () => {},
    private readonly onJoined:        JoinedHandler        = () => {},
  ) {}

  getPeerId(): string | null { return this.peerId; }
  getHostId(): string | null { return this.hostId; }

  hostRoom(signalingUrl: string, roomId: string) {
    void this.connect(signalingUrl, roomId, 'host');
  }

  joinRoom(signalingUrl: string, roomId: string) {
    void this.connect(signalingUrl, roomId, 'guest');
  }

  // Broadcast (host) or send to host (guest).
  send(data: unknown) {
    const payload = JSON.stringify(data);
    for (const entry of this.peers.values()) {
      if (entry.channel?.readyState === 'open') entry.channel.send(payload);
    }
  }

  // Send to a specific peer.
  sendTo(peerId: string, data: unknown) {
    const entry = this.peers.get(peerId);
    if (entry?.channel?.readyState === 'open') entry.channel.send(JSON.stringify(data));
  }

  dispose() {
    this.ws?.close();
    for (const entry of this.peers.values()) entry.pc.close();
    this.peers.clear();
  }

  private async connect(url: string, roomId: string, role: Role) {
    this.role = role;
    this.onStatus('connecting');

    this.iceServers = await fetchIceServers(url);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', roomId, role }));
    });

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string) as SignalingMsg;
      this.handleSignaling(msg).catch(console.error);
    });

    ws.addEventListener('close', () => {
      if (!this.anyPeerOpen()) this.onStatus('disconnected');
    });
  }

  private async handleSignaling(msg: SignalingMsg) {
    switch (msg.type) {
      case 'joined':
        this.peerId = msg.peerId as string;
        this.hostId = (msg.hostId as string | null) ?? null;
        this.onJoined(this.peerId, this.hostId);
        if (this.role === 'host') {
          // Existing peers (rare path: host joining late) get offers.
          for (const p of msg.otherPeers as { peerId: string; role: Role }[]) {
            await this.dialPeer(p.peerId);
          }
        }
        break;

      case 'peer-joined':
        if (this.role === 'host') await this.dialPeer(msg.peerId as string);
        break;

      case 'peer-left':
        this.tearDownPeer(msg.peerId as string);
        this.onPeerLeft(msg.peerId as string);
        break;

      case 'offer':
        await this.handleOffer(msg.fromPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;

      case 'answer':
        await this.handleAnswer(msg.fromPeerId as string, msg.sdp as RTCSessionDescriptionInit);
        break;

      case 'ice-candidate':
        await this.handleIce(msg.fromPeerId as string, msg.candidate as RTCIceCandidateInit);
        break;

      case 'room-full':
        this.onStatus('room-full');
        break;
    }
  }

  private async dialPeer(remoteId: string) {
    const entry = this.createPeer(remoteId, 'host');
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    this.signal({ type: 'offer', targetPeerId: remoteId, sdp: offer });
  }

  private async handleOffer(remoteId: string, sdp: RTCSessionDescriptionInit) {
    let entry = this.peers.get(remoteId);
    if (!entry) entry = this.createPeer(remoteId, 'guest');
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    this.signal({ type: 'answer', targetPeerId: remoteId, sdp: answer });
  }

  private async handleAnswer(remoteId: string, sdp: RTCSessionDescriptionInit) {
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  private async handleIce(remoteId: string, candidate: RTCIceCandidateInit) {
    const entry = this.peers.get(remoteId);
    if (!entry || !candidate) return;
    await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private createPeer(remoteId: string, localRole: Role): PeerEntry {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry: PeerEntry = { pc, channel: null, open: false };
    this.peers.set(remoteId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ type: 'ice-candidate', targetPeerId: remoteId, candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.markPeerClosed(remoteId);
      }
    };

    if (localRole === 'host') {
      const ch = pc.createDataChannel('game');
      entry.channel = ch;
      this.wireChannel(remoteId, ch);
    } else {
      pc.ondatachannel = (e) => {
        entry.channel = e.channel;
        this.wireChannel(remoteId, e.channel);
      };
    }

    return entry;
  }

  private wireChannel(remoteId: string, ch: RTCDataChannel) {
    ch.onopen = () => {
      const entry = this.peers.get(remoteId);
      if (entry) entry.open = true;
      this.onStatus('connected');
      this.onPeerConnected(remoteId);
    };
    ch.onclose = () => this.markPeerClosed(remoteId);
    ch.onmessage = (e) => this.onMsg(remoteId, JSON.parse(e.data as string));
  }

  private markPeerClosed(remoteId: string) {
    const entry = this.peers.get(remoteId);
    if (entry) entry.open = false;
    if (!this.anyPeerOpen()) this.onStatus('disconnected');
  }

  private tearDownPeer(remoteId: string) {
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    entry.pc.close();
    this.peers.delete(remoteId);
    if (!this.anyPeerOpen()) this.onStatus('disconnected');
  }

  private anyPeerOpen(): boolean {
    for (const entry of this.peers.values()) if (entry.open) return true;
    return false;
  }

  private signal(msg: unknown) {
    this.ws?.send(JSON.stringify(msg));
  }
}
