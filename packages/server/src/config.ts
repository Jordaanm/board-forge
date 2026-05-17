// Hard cap on simultaneous peers per room (host + seated guests + spectators).
// Override with MAX_ROOM_PEERS env var.
export const maxRoomPeers = Number(process.env.MAX_ROOM_PEERS ?? 16);

// ICE server configuration.
//
// STUN_URLS:      comma-separated stun: URLs. Defaults to Google's public STUN.
// TURN_KEY_ID:    Cloudflare Calls TURN App Key ID (a.k.a. "Turn Token ID").
// TURN_API_TOKEN: Cloudflare API token used as Bearer auth when minting creds.
//
// Cloudflare has no long-lived TURN credentials — we mint short-lived ones via
// POST /v1/turn/keys/<key_id>/credentials/generate-ice-servers and cache them
// in memory until shortly before expiry.
//
// If TURN_KEY_ID / TURN_API_TOKEN are unset, clients fall back to STUN-only
// (peers behind symmetric NAT will fail to connect).

const STUN_URLS = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const TURN_KEY_ID             = process.env.TURN_KEY_ID    ?? '';
const TURN_API_TOKEN          = process.env.TURN_API_TOKEN ?? '';
const TURN_TTL_SEC            = Number(process.env.TURN_TTL_SEC ?? 86400);
const TURN_REFRESH_BUFFER_SEC = 3600;

export interface IceServer {
  urls:        string | string[];
  username?:   string;
  credential?: string;
}

interface CachedTurn {
  servers:   IceServer[];
  expiresAt: number;
}

let cache:    CachedTurn | null              = null;
let inflight: Promise<IceServer[]> | null    = null;

async function mintCloudflareTurn(): Promise<IceServer[]> {
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${TURN_API_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ ttl: TURN_TTL_SEC }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloudflare TURN mint failed: ${res.status} ${body}`);
  }
  const body = await res.json() as { iceServers?: IceServer | IceServer[] };
  if (!body.iceServers) return [];
  return Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
}

// Discord OAuth.
//
// DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET — credentials from the Discord
// developer portal. The client never sees the secret; only this server uses
// it when exchanging an authorization code (or refresh token) for tokens at
// POST /oauth/discord/exchange.
//
// DISCORD_REDIRECT_URI_ALLOWLIST — CSV of redirect URIs we will accept from
// callers and forward to Discord. Defense-in-depth on top of Discord's own
// redirect_uri check.
export const discordClientId          = process.env.DISCORD_CLIENT_ID     ?? '';
export const discordClientSecret      = process.env.DISCORD_CLIENT_SECRET ?? '';
export const discordRedirectAllowlist = new Set(
  (process.env.DISCORD_REDIRECT_URI_ALLOWLIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

export async function getIceServers(): Promise<IceServer[]> {
  const stun: IceServer[] = STUN_URLS.length ? [{ urls: STUN_URLS }] : [];
  if (!TURN_KEY_ID || !TURN_API_TOKEN) return stun;

  const now = Date.now();
  if (cache && now < cache.expiresAt) return [...stun, ...cache.servers];

  if (!inflight) {
    inflight = mintCloudflareTurn()
      .then(servers => {
        cache = { servers, expiresAt: Date.now() + (TURN_TTL_SEC - TURN_REFRESH_BUFFER_SEC) * 1000 };
        return servers;
      })
      .finally(() => { inflight = null; });
  }

  try {
    const servers = await inflight;
    return [...stun, ...servers];
  } catch (err) {
    console.warn('[TURN] mint failed, returning STUN-only', err);
    return stun;
  }
}
