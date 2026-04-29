// Hard cap on simultaneous peers per room (host + seated guests + spectators).
// Override with MAX_ROOM_PEERS env var.
export const maxRoomPeers = Number(process.env.MAX_ROOM_PEERS ?? 16);

// ICE server configuration.
// STUN_URLS: comma-separated stun: URLs. Defaults to Google's public STUN.
// TURN: optional. If TURN_URL is unset, no TURN server is advertised and clients fall
// back to STUN-only (peers behind symmetric NAT will fail to connect).
//
// For production, swap the static TURN_USERNAME/TURN_CREDENTIAL for short-lived HMAC
// credentials minted per request — see planning/web-rtc.md.
const STUN_URLS = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const TURN_URL        = process.env.TURN_URL        ?? '';
const TURN_USERNAME   = process.env.TURN_USERNAME   ?? '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL ?? '';

export interface IceServer {
  urls:        string | string[];
  username?:   string;
  credential?: string;
}

export function getIceServers(): IceServer[] {
  const servers: IceServer[] = [];
  if (STUN_URLS.length) servers.push({ urls: STUN_URLS });
  if (TURN_URL) {
    servers.push({
      urls:       TURN_URL,
      username:   TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }
  return servers;
}
