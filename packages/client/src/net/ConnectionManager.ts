type Status = 'connecting' | 'connected' | 'disconnected' | 'room-full' | 'wrong-password' | 'banned';
type Role   = 'host' | 'guest';

export interface RoomSettings {
  name:        string;
  hasPassword: boolean;
}

export interface PublicBanEntry {
  name:     string;
  bannedAt: string;
}

type MsgHandler             = (peerId: string, msg: unknown) => void;
type StatusHandler          = (s: Status) => void;
type PeerLeftHandler        = (peerId: string) => void;
type PeerConnectedHandler   = (peerId: string, displayName: string) => void;
type JoinedHandler          = (peerId: string, hostPeerId: string | null) => void;
type RoomSettingsHandler    = (settings: RoomSettings) => void;
type BansUpdatedHandler     = (bans: PublicBanEntry[]) => void;

type SignalingMsg = { type: string; [k: string]: unknown };

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const RELIABLE_LABEL   = 'game';
const UNRELIABLE_LABEL = 'game-unreliable';

interface PeerEntry {
  pc:         RTCPeerConnection;
  reliable:   RTCDataChannel | null;
  unreliable: RTCDataChannel | null;
  open:       boolean;  // true once the reliable channel opens
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

export interface SendOpts {
  reliable?: boolean;  // default true
}

// Two RTCDataChannels per peer (issue #9 of issues--arch.md):
//   - 'game'           — ordered, retransmitted: scene replication, RPCs, snapshots.
//   - 'game-unreliable' — ordered:false, maxRetransmits:0: transform / cursor.
//
// Rollout: opening both channels in one negotiation is a breaking change for
// any client that only handles a single 'game' label — none deployed yet, so
// hosts and guests must roll out together. Future versioning could fall back
// to reliable-only when the second channel is missing.
export class ConnectionManager {
  private ws:         WebSocket | null = null;
  private peerId:     string | null = null;
  private role:       Role | null = null;
  private hostId:     string | null = null;
  private peers       = new Map<string, PeerEntry>();
  private peerNames   = new Map<string, string>();
  private iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;
  private disposed    = false;
  private displayName = '';
  private password: string | null = null;

  constructor(
    private readonly onMsg:             MsgHandler,
    private readonly onStatus:          StatusHandler,
    private readonly onPeerLeft:        PeerLeftHandler        = () => {},
    private readonly onPeerConnected:   PeerConnectedHandler   = () => {},
    private readonly onJoined:          JoinedHandler          = () => {},
    private readonly onRoomSettings:    RoomSettingsHandler    = () => {},
    private readonly onBansUpdated:     BansUpdatedHandler     = () => {},
  ) {}

  setRoomName(name: string) {
    this.signal({ type: 'setRoomName', name });
  }

  setRoomPassword(password: string | null) {
    this.signal({ type: 'setRoomPassword', password });
  }

  banPeer(peerId: string) {
    this.signal({ type: 'banPeer', peerId });
  }

  unban(name: string) {
    this.signal({ type: 'unban', name });
  }

  getPeerId(): string | null { return this.peerId; }
  getHostId(): string | null { return this.hostId; }

  getPeerIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.peers) {
      if (entry.reliable?.readyState === 'open') ids.push(id);
    }
    return ids;
  }

  hostRoom(signalingUrl: string, roomId: string, displayName: string) {
    this.displayName = displayName;
    this.password = null;
    void this.connect(signalingUrl, roomId, 'host');
  }

  joinRoom(signalingUrl: string, roomId: string, displayName: string, password: string | null = null) {
    this.displayName = displayName;
    this.password = password;
    void this.connect(signalingUrl, roomId, 'guest');
  }

  getPeerDisplayName(peerId: string): string | null {
    return this.peerNames.get(peerId) ?? null;
  }

  // Broadcast (host) or send to host (guest). Defaults to the reliable
  // channel; pass `{ reliable: false }` to drop on the unreliable channel.
  // If the unreliable channel hasn't opened yet, falls back to reliable.
  send(data: unknown, opts: SendOpts = {}) {
    const payload  = JSON.stringify(data);
    const reliable = opts.reliable !== false;
    for (const entry of this.peers.values()) {
      const ch = pickChannel(entry, reliable);
      if (ch?.readyState === 'open') ch.send(payload);
    }
  }

  // Send to a specific peer.
  sendTo(peerId: string, data: unknown, opts: SendOpts = {}) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    const ch = pickChannel(entry, opts.reliable !== false);
    if (ch?.readyState === 'open') ch.send(JSON.stringify(data));
  }

  // Forcibly disconnect a peer. Used by the host for kick / ban.
  kickPeer(peerId: string) {
    this.tearDownPeer(peerId);
  }

  dispose() {
    this.disposed = true;
    this.ws?.close();
    for (const entry of this.peers.values()) entry.pc.close();
    this.peers.clear();
  }

  private async connect(url: string, roomId: string, role: Role) {
    this.role = role;
    this.onStatus('connecting');

    this.iceServers = await fetchIceServers(url);
    if (this.disposed) return;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type:        'join',
        roomId,
        role,
        displayName: this.displayName,
        password:    this.password ?? undefined,
      }));
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
        for (const p of (msg.otherPeers as { peerId: string; role: Role; displayName?: string }[] | undefined) ?? []) {
          if (typeof p.displayName === 'string') this.peerNames.set(p.peerId, p.displayName);
        }
        if (msg.roomSettings && typeof (msg.roomSettings as RoomSettings).name === 'string') {
          this.onRoomSettings(msg.roomSettings as RoomSettings);
        }
        if (Array.isArray(msg.bans)) {
          this.onBansUpdated(msg.bans as PublicBanEntry[]);
        }
        this.onJoined(this.peerId, this.hostId);
        if (this.role === 'host') {
          // Existing peers (rare path: host joining late) get offers.
          for (const p of msg.otherPeers as { peerId: string; role: Role; displayName?: string }[]) {
            await this.dialPeer(p.peerId);
          }
        }
        break;

      case 'roomSettingsUpdated':
        if (typeof msg.name === 'string') {
          this.onRoomSettings({
            name:        msg.name,
            hasPassword: msg.hasPassword === true,
          });
        }
        break;

      case 'joinRejected':
        if      (msg.reason === 'wrongPassword') this.onStatus('wrong-password');
        else if (msg.reason === 'banned')        this.onStatus('banned');
        break;

      case 'bansUpdated':
        if (Array.isArray(msg.bans)) this.onBansUpdated(msg.bans as PublicBanEntry[]);
        break;

      case 'peer-joined': {
        const peerId      = msg.peerId as string;
        const displayName = typeof msg.displayName === 'string' ? msg.displayName : '';
        this.peerNames.set(peerId, displayName);
        if (this.role === 'host') await this.dialPeer(peerId);
        break;
      }

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
    const entry: PeerEntry = { pc, reliable: null, unreliable: null, open: false };
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
      const reliable   = pc.createDataChannel(RELIABLE_LABEL,   { ordered: true });
      const unreliable = pc.createDataChannel(UNRELIABLE_LABEL, { ordered: false, maxRetransmits: 0 });
      entry.reliable   = reliable;
      entry.unreliable = unreliable;
      this.wireChannel(remoteId, reliable);
      this.wireChannel(remoteId, unreliable);
    } else {
      pc.ondatachannel = (e) => {
        if (e.channel.label === UNRELIABLE_LABEL) entry.unreliable = e.channel;
        else                                      entry.reliable   = e.channel;
        this.wireChannel(remoteId, e.channel);
      };
    }

    return entry;
  }

  private wireChannel(remoteId: string, ch: RTCDataChannel) {
    ch.onopen = () => {
      const entry = this.peers.get(remoteId);
      if (!entry) return;
      // "Connected" is gated on the reliable channel — the unreliable one is
      // an optimisation that may take longer (or never) to open over flaky
      // links. send() falls back to reliable if unreliable isn't ready.
      if (ch.label === RELIABLE_LABEL) {
        entry.open = true;
        this.onStatus('connected');
        this.onPeerConnected(remoteId, this.peerNames.get(remoteId) ?? '');
      }
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
    this.peerNames.delete(remoteId);
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

function pickChannel(entry: PeerEntry, reliable: boolean): RTCDataChannel | null {
  if (reliable) return entry.reliable;
  // Unreliable preferred for non-critical traffic; fall back to reliable when
  // the unreliable channel isn't open yet so the message still gets through.
  if (entry.unreliable?.readyState === 'open') return entry.unreliable;
  return entry.reliable;
}
