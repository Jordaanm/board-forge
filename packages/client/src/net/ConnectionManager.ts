type Status = 'connecting' | 'connected' | 'disconnected' | 'room-full';
type MsgHandler = (msg: unknown) => void;
type StatusHandler = (s: Status) => void;

type SignalingMsg = { type: string; [k: string]: unknown };

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;

  constructor(
    private readonly onMsg: MsgHandler,
    private readonly onStatus: StatusHandler
  ) {}

  hostRoom(signalingUrl: string, roomId: string) {
    this.connect(signalingUrl, roomId, 'host');
  }

  joinRoom(signalingUrl: string, roomId: string) {
    this.connect(signalingUrl, roomId, 'guest');
  }

  send(data: unknown) {
    this.channel?.send(JSON.stringify(data));
  }

  dispose() {
    this.ws?.close();
    this.pc?.close();
  }

  private connect(url: string, roomId: string, role: 'host' | 'guest') {
    this.onStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', roomId, role }));
      if (role === 'host') this.setupPeer('host');
    });

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string) as SignalingMsg;
      this.handleSignaling(msg, role).catch(console.error);
    });

    ws.addEventListener('close', () => {
      if (this.pc?.connectionState !== 'connected') this.onStatus('disconnected');
    });
  }

  private setupPeer(role: 'host' | 'guest') {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ type: 'ice-candidate', candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.onStatus('connected');
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.onStatus('disconnected');
      }
    };

    if (role === 'host') {
      const ch = pc.createDataChannel('game');
      this.channel = ch;
      this.wireChannel(ch);
    } else {
      pc.ondatachannel = (e) => {
        this.channel = e.channel;
        this.wireChannel(e.channel);
      };
    }
  }

  private wireChannel(ch: RTCDataChannel) {
    ch.onopen = () => this.onStatus('connected');
    ch.onclose = () => this.onStatus('disconnected');
    ch.onmessage = (e) => this.onMsg(JSON.parse(e.data as string));
  }

  private async handleSignaling(msg: SignalingMsg, role: 'host' | 'guest') {
    const pc = this.pc;

    switch (msg.type) {
      case 'peer-joined':
        if (role === 'host' && pc) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.signal({ type: 'offer', sdp: offer });
        }
        break;

      case 'room-ready':
        if (role === 'guest') this.setupPeer('guest');
        break;

      case 'offer':
        if (role === 'guest' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.signal({ type: 'answer', sdp: answer });
        }
        break;

      case 'answer':
        if (role === 'host' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        }
        break;

      case 'ice-candidate':
        if (pc && msg.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit));
        }
        break;

      case 'room-full':
        this.onStatus('room-full');
        break;
    }
  }

  private signal(msg: unknown) {
    this.ws?.send(JSON.stringify(msg));
  }
}
