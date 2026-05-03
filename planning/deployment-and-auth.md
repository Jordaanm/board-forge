# Deployment & Auth Plan

Plan for the first deployed test of the virtual tabletop with real players, Discord OAuth login, and AWS hosting.

## Scope

- **Audience:** ~10 invited testers, 1–3 concurrent rooms
- **Duration:** ~2–4 weeks of continuous uptime
- **Distribution:** invite-only via Discord-ID blacklist (env var)
- **Goal:** validate identity flow, multi-peer networking, and seat lifecycle with real players. Not an open beta.

## Identity Model

Three identifiers, ordered by stability:

| ID | Lifetime | Source | Purpose |
|---|---|---|---|
| `discordId` | Forever | Discord OAuth `identify` scope | Stable user identity. Binds seats, bans, host status. |
| `seat` (0–7) | Per-room session | Auto-assigned on join, host-managed | Game-mechanic identity. Cursor colour, ownership, hidden info (later). |
| `peerId` | Per WS connection | Server-assigned UUID | Wire-level routing. Recreated on every reconnect. |

`discordId` is the unique key. `peerId` is sub to that. Seats reclaim automatically on reconnect because the host's `RoomStateManager` keys by `discordId`.

## Auth Architecture

### Stateless JWT cookie

- No database. No server-side session store.
- `/auth/discord/callback` exchanges OAuth code → fetches profile → signs a JWT containing `{discordId, username, avatarUrl, iat, exp}` → drops it into an HttpOnly cookie.
- Profile re-fetched from Discord on every login. Avatar/name updates propagate naturally.
- Cookie is the source of truth. localStorage holds a non-authoritative profile cache for instant render.

### OAuth flow

1. User visits `/r/<id>` (or `/`) without a valid cookie → page renders skeleton with login modal overlaid
2. User clicks "Sign in with Discord" → full-page navigation to `https://discord.com/oauth2/authorize?...&state=<signed>&scope=identify`
3. Discord redirects to `https://vt.<domain>/auth/discord/callback?code=…&state=…`
4. Server validates `state` HMAC, exchanges code for token, fetches profile via `/api/users/@me`
5. Server checks global ban: if `discordId ∈ BANNED_DISCORD_IDS` → render `403 banned` page (no cookie set)
6. Server signs JWT, sets cookie, 302 to the `state.returnUrl`
7. Page reloads with cookie present, modal hidden, app renders

### OAuth state CSRF

Stateless: `state` is HMAC-signed payload `{returnUrl, nonce, expiry}` using `JWT_SIGNING_KEY`. Server validates signature + expiry on callback. No nonce store needed.

### Scopes

Only `identify`. No `email`, no `guilds`. Privacy minimalism + simpler app review.

### Cookie config

| Env | Attributes |
|---|---|
| Dev (`http://localhost:3001`) | `HttpOnly; SameSite=Lax` |
| Prod (`https://vt.<domain>`) | `HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` (30 days) |

Conditional on `PUBLIC_URL.startsWith('https://')` — *not* `NODE_ENV`.

### Two-layer ban list

| Layer | Storage | Enforced at | Lifecycle |
|---|---|---|---|
| Global | `BANNED_DISCORD_IDS` env var (CSV) | OAuth callback | Edit env + restart server |
| Per-room | `room.bannedDiscordIds: Set<string>` in server's `Room` record | WS upgrade | Host edits via host-only panel; dies with room |

### localStorage profile cache

```ts
type CachedProfile = {
  discordId: string;
  username:  string;
  avatarUrl: string;
  cachedAt:  number;  // unix ms
};
```

Behaviour:
- **Read on pageload:** if `now - cachedAt < 30 days`, render optimistically. Otherwise, treat as cache-miss and show login modal until `/api/me` responds.
- **Background validation:** always fire `/api/me` after optimistic render. 200 → refresh cache. 401 → cookie expired or revoked → clear cache + show login modal (even mid-session).
- **Logout:** clear cache before redirect.
- **Storage key:** `vt:profile`

## Server Changes

### New HTTP routes

| Route | Method | Purpose |
|---|---|---|
| `/` (and SPA paths) | GET | Static React bundle (Vite output) |
| `/auth/discord/login` | GET | 302 → Discord with signed `state` |
| `/auth/discord/callback` | GET | Exchange code, fetch profile, check global ban, set cookie, 302 to `state.returnUrl` |
| `/auth/logout` | POST | Clear cookie |
| `/api/me` | GET | Verify cookie → return `{discordId, username, avatarUrl}` or 401 |
| `/api/rooms` | POST | Mint room ID, set `hostDiscordId = caller`, return `{roomId}` |
| `/ws` | GET (Upgrade) | Cookie-verified WebSocket signaling |
| `/ice-config` | GET | TURN credentials (dormant until Cloudflare env vars set) |

### WS upgrade authentication

Before `wss.handleUpgrade`, parse cookie, verify JWT, look up room. Reject early:
- Invalid/missing cookie → `401`
- `discordId ∈ BANNED_DISCORD_IDS` (global) → `401`
- `discordId ∈ room.bannedDiscordIds` (per-room) → `403`
- `roomId` doesn't exist → `404`
- Room peer count `>= MAX_ROOM_PEERS` → `503`

If accepted, attach `{discordId, username, avatarUrl}` to `ws` before emitting `connection`.

### Role determination

Server-derived: `isHost = ws.profile.discordId === room.hostDiscordId`. Client never asserts. Drop the existing `?host=true` URL flag — security hole.

### Multi-peer cap

Lift the hardcoded host+1 cap in `rooms.ts`. Use the existing `MAX_ROOM_PEERS` env (default 16). Realistically: 8 seats + handful of spectators.

### Ban management (over WS, not REST)

Two new client → server message types:
- `host:kick-ban` — `{ discordId }` — server validates sender is host, force-closes target's WS, adds to `room.bannedDiscordIds`. Server enforces: host cannot kick self.
- `host:unban` — `{ discordId }` — removes from set. Banned user must reload to rejoin.

Server pushes updated ban set to host's panel via existing `room-state-patch` infrastructure.

### Room reaper

Rooms with no live host WS for >60s get garbage collected. `hostFirstConnected: boolean` distinguishes "starting up" from "host crashed."

### Seat re-keying

`RoomStateManager` re-keyed from `peerId` to `discordId`. Reconnect = same seat. Host bound by `room.hostDiscordId`, fully decoupled from any specific seat — host can sit anywhere, change seats, or be a spectator.

### Stack additions

- `cookie-parser` (Express middleware)
- `jose` for JWT sign/verify (lighter than `jsonwebtoken`)
- No OAuth library — Discord's flow is two `fetch` calls

## Client Changes

### Login modal

Overlaid on lobby + room pages when no cookie/cache. Discord-styled "Sign in with Discord" button per their brand guidelines (rejected at app-review otherwise). Click → full-page redirect to Discord. Page returns post-callback with cookie set.

### Lobby (`/`)

- Top-right: avatar + username + sign-out
- Centre: "Create New Room" button → `POST /api/rooms` → 302 to `/r/<id>`
- Below: "Join a room" paste-link input
- Below: "Recent rooms" (last 5 from localStorage, click to rejoin, tolerate 404 with "room ended" toast)

### Room — player list panel (top-right, collapsible)

- One row per peer: avatar, name, seat-colour dot (or "Spectator"), online/disconnected dot, crown icon if host
- Right-click row → context menu:
  - **Self:** "Change Seat", "Leave Seat" (or "Take Seat" if currently spectator)
  - **Other (you're not host):** menu does not open
  - **Other (you're host):** "Kick & Ban", divider, "Copy Discord ID"

### Change-Seat picker (chair overlay)

Two activation modes:
- **Spectator (not seated):** chairs always visible around the table. Click empty chair → take seat.
- **Seated player:** chairs hidden. Player-list right-click → "Change Seat" toggles overlay. Click empty chair → swap. Click outside / Esc → dismiss.

Geometry reuses coords already in `SeatLayout.ts`.

### Host management panel

Host-only "Room Settings" button in top bar:
- "Banned in this room" — list of `discordId`s with "Unban" per row
- (Future) recent kicks log
- (Future) room ID copy + share link

### Cursor display

Solid seat-colour circle. No name, no avatar, no label. Name and avatar appear *only* in the player list panel. Spectators' cursors are not broadcast.

> Audit `live peer cursor tracking on the table` (recent commit) and rip out any name labels.

## Networking

### Single-origin deployment

One Bun + Express + ws process serves everything at `https://vt.<domain>`:
- `/` and SPA paths → static Vite bundle
- `/auth/*`, `/api/*` → REST
- `/ws` → WebSocket signaling (cookie-authenticated)
- `/ice-config` → TURN creds (dormant)

Cookie scoped to `vt.<domain>`. No CORS. No CDN. One artifact, one deploy.

> Switch to split-origin (S3+CloudFront for static, separate backend) later when SPA bundle dominates first-paint or rolling backend deploys start dropping connections that matter.

### Multi-peer star topology

Star, host-authoritative. Already supported by client `ConnectionManager`. Server peer cap raised to 16. Realistic occupancy: ~10.

## TURN

### Provider: Cloudflare Calls TURN

- $0.05/GB beyond 1TB/mo free tier (effectively free at this scale)
- Multi-region — Sydney POP serves AU testers with lower latency than self-hosted on a single EC2
- Zero ops

### Integration shape (build now, dormant until activation)

Extend the existing `/ice-config` endpoint:

```ts
app.get('/ice-config', async (req, res) => {
  const ice: RTCIceServer[] = [{ urls: STUN_URLS.split(',') }];
  if (CLOUDFLARE_CALLS_APP_ID && CLOUDFLARE_CALLS_APP_TOKEN) {
    const creds = await fetchCloudflareTurnCreds(); // 1h TTL, server-cached
    ice.push({
      urls: ['turn:turn.cloudflare.com:3478', 'turns:turn.cloudflare.com:5349'],
      username: creds.username,
      credential: creds.credential,
    });
  }
  res.json({ iceServers: ice });
});
```

Server-side cache the creds with proactive refresh ahead of expiry. Never call Cloudflare per-client-request (rate-limit risk).

Client unchanged — already passes `iceServers` into `RTCPeerConnection`.

### Activation procedure

1. Sign up at `cloudflare.com` (~5 min, free, no credit card)
2. Dashboard → Calls → create app → copy App ID + Token
3. SSH to box, append two lines to `/etc/virtual-table/env`:
   ```
   CLOUDFLARE_CALLS_APP_ID=...
   CLOUDFLARE_CALLS_APP_TOKEN=...
   ```
4. `sudo systemctl restart virtual-table`
5. Tester reloads → next ICE negotiation includes TURN

### Self-hosted coturn (documented fallback)

Kept in `planning/web-rtc.md` as a fallback if Cloudflare's pricing changes or the test scope outgrows the free tier. Don't build it now.

### TURN observability

Add a tiny client-side ICE-state log that posts to a `/api/debug/ice` endpoint on connection establishment. Otherwise "feels laggy" reports are uninvestigable.

## Domain & TLS

> **Blocked on choosing a domain.** Recommendations: register at Cloudflare ($11/yr, free DNS, no upsells). Avoid free dynamic-DNS (`*.duckdns.org` etc) — Discord eyes them suspiciously, Let's Encrypt rate-limits.

Subdomain: `vt.<domain>` (leaves apex free, makes future infra splits cleaner).

### Caddy in front of Bun on the same EC2

```
vt.<domain> {
  reverse_proxy localhost:3001
}
```

Caddy auto-issues + auto-renews Let's Encrypt cert, handles WS upgrade transparently, redirects 80→443 for free. Bun stays on `localhost:3001` — no setcap, no privileged binding, restartable without dropping the cert.

## AWS Infrastructure

### Single EC2 instance

| Item | Value |
|---|---|
| Region | `ap-southeast-2` (Sydney) |
| Instance | `t4g.small` (2 vCPU ARM Graviton, 2GB RAM, ~$12/mo on-demand, ~$8/mo with 1-yr savings plan) |
| AMI | Ubuntu 24.04 LTS ARM64 |
| Storage | 20GB gp3 (~$1.60/mo) |
| Network | Elastic IP attached (free while attached, stable across stop/start) |
| Security group | Inbound: 22 (SSH from your IP), 80, 443. Outbound: all. |

### Process supervision: systemd

`/etc/systemd/system/virtual-table.service`:
```ini
[Service]
ExecStart=/usr/local/bin/bun run packages/server/dist/index.js
Restart=on-failure
EnvironmentFile=/etc/virtual-table/env
User=virtual-table
WorkingDirectory=/opt/virtual-table

[Install]
WantedBy=multi-user.target
```

Auto-restart on crash. Logs to journald. Caddy installed via official apt repo gets its own auto-managed unit.

### Logs

journald.
- `journalctl -u virtual-table -f` — live tail
- `journalctl -u virtual-table --since "1 hour ago"` — incidents
- `journalctl -u caddy -f` — Caddy access/errors

No CloudWatch agent. Punt centralised logging until there's a reason.

### Cost estimate

| Item | Monthly |
|---|---|
| EC2 `t4g.small` on-demand | ~$12 |
| EBS gp3 20GB | ~$1.60 |
| Elastic IP (attached) | $0 |
| Egress (signaling + static, no TURN active) | ~$0.05 |
| Cloudflare Calls (active, est worst case ~5GB/mo) | $0 (free tier) |
| Domain | ~$1 (amortised yearly) |
| **Total** | **~$15/mo** |

If first-year free-tier eligible: save ~$8/mo for 12 months on `t3.micro` (worse perf for the price; usually not worth the downgrade unless free tier is a hard constraint).

## Secrets & Configuration

### `/etc/virtual-table/env`

Root-owned, `0600`, loaded by systemd `EnvironmentFile=`. Edit via SSH only, copy canonical version to password manager.

```
PORT=3001
PUBLIC_URL=https://vt.<domain>

DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://vt.<domain>/auth/discord/callback

JWT_SIGNING_KEY=<openssl rand -base64 32>
COOKIE_DOMAIN=vt.<domain>

BANNED_DISCORD_IDS=

# TURN block — empty until activated
CLOUDFLARE_CALLS_APP_ID=
CLOUDFLARE_CALLS_APP_TOKEN=

STUN_URLS=stun:stun.l.google.com:19302

MAX_ROOM_PEERS=16
```

### Discord OAuth app config

Register at `https://discord.com/developers/applications`. Add **two** redirect URIs (same app for dev + prod):
- `http://localhost:3001/auth/discord/callback`
- `https://vt.<domain>/auth/discord/callback`

Scopes: `identify` only.

### Secret rotation

| Secret | Rotation impact | Where |
|---|---|---|
| `DISCORD_CLIENT_SECRET` | Lost = regenerate via Discord dashboard | Password manager + env file |
| `JWT_SIGNING_KEY` | Rotate = all sessions invalidated, everyone re-logs in | Password manager + env file |
| `CLOUDFLARE_CALLS_APP_TOKEN` | Lost = regenerate via Cloudflare dashboard | Password manager + env file |

## Deployment Mechanism

### Local `deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
ssh vt-prod 'cd /opt/virtual-table \
  && git pull \
  && bun install \
  && bun run build \
  && sudo systemctl restart virtual-table'
```

Manual cadence. ~30s per deploy. Restarts drop all WebSocket connections — testers reload, reclaim seat by Discord ID, host's room rebuilds.

> Move to GitHub Actions when manual deploys start grating, not before.

### One-time `provision.sh`

Checked into the repo. Idempotent. Runs against a fresh Ubuntu 24.04 ARM box:
1. `apt update && apt upgrade -y && apt install -y curl unzip git`
2. Install Bun (`curl -fsSL bun.sh/install | bash`)
3. Install Caddy via official apt repo
4. Create `virtual-table` system user + `/opt/virtual-table` dir
5. Clone repo
6. Install systemd unit at `/etc/systemd/system/virtual-table.service`
7. Drop placeholder `/etc/virtual-table/env` (root:root 0600)
8. Drop Caddyfile at `/etc/caddy/Caddyfile`
9. `systemctl daemon-reload && systemctl enable --now caddy virtual-table`

User SSHes in once after `provision.sh` completes to populate the env file. Then `deploy.sh` from the laptop forever after.

### Build location

On the box. Bun + workspace install footprint is small (~200MB). One less layer than building locally and rsyncing.

## Sequencing

Each step ships independently and the app keeps working:

1. Add `cookie-parser` + `jose`. Ship `/auth/discord/*` and `/api/me`. No WS changes yet — verify OAuth alone works against localhost dev callback.
2. Add `POST /api/rooms`. Modify `rooms.ts` to track `hostDiscordId` instead of `hostPeerId`. Lift host+1 cap.
3. Move WS upgrade behind cookie verification. Remove `?host=true`. Client uses `/api/rooms` to mint, navigates to `/r/<id>` (no role flag).
4. Re-key `RoomStateManager` from peerId to discordId. Auto-assign on first connect, reclaim on reconnect. Update `signaling.test.ts` and `RoomStateManager.test.ts`.
5. Build login modal, lobby, `/api/me` integration on client. Profile cache with expiry handling. Logout flow.
6. Build player list panel (top-right, right-click context menu).
7. Build Change Seat picker (chair overlay, two activation modes).
8. Build host management panel (ban list editing).
9. Add `host:kick-ban` and `host:unban` WS messages. Wire into player list context menu.
10. Strip cursor labels — cursor is solid seat-colour circle only.
11. Buy domain, provision EC2, run `provision.sh`, configure Caddy, register Discord OAuth app, populate env, run `deploy.sh`.
12. Stub Cloudflare Calls integration in `/ice-config`. Don't activate yet.
13. Invite testers. Activate Cloudflare Calls if anyone reports connection failure.

## Pitfalls & Known Limits

- **Host crash kills the room.** No migration. If the host's machine dies mid-session, others reconnect → server's room briefly exists with no host → reaper GCs it after 60s. Host refreshes and creates a new room. Acceptable for this scope; resiliency added in a later release.
- **Indefinite seat-holding.** A seat is freed only when the user clicks "Leave Seat" or the host kicks them. If Alice rage-quits and never returns, her seat is held until host action. For 10 friends, a one-keypress fix; consider grace-period reaper later.
- **Banning a seated user mid-session.** WS force-close is immediate. Their cookie remains valid until expiry, but `room.bannedDiscordIds` blocks reconnect to that room. Global ban via env requires server restart.
- **Restart drops all WS connections.** Testers reload, reclaim seats. Smooth-ish but jarring during deploy mid-session. Plan deploys for between sessions.
- **Recent rooms localStorage rot.** Room may be dead by the time user clicks. Server returns 404 → toast + remove from list.
- **Discord username changes.** Cached avatar/name in localStorage is stale until next login. Acceptable; not worth a focus-refresh mechanism.
- **TURN traffic is opaque.** Without `/api/debug/ice` instrumentation, "feels laggy" reports are uninvestigable.
- **`SameSite=Lax` is correct here.** Sends cookies on top-level GET nav including OAuth callback. Don't switch to `Strict` — first navigation back from Discord wouldn't send the cookie.
- **`identify` scope re-auth.** If you add scopes later (e.g. `guilds`), every existing user re-consents on next login.
- **Free tier trap.** `t4g.small` is *not* free-tier eligible. Free tier is `t2.micro`/`t3.micro` (x86, worse perf). Worth using only if free tier is a hard cost constraint.

## Out of Scope (For Later)

- Host migration on disconnect
- Grace-period reaper for inactive seats
- Persistent user records / login audit
- Seat tokens (PRD §grace, replaced by Discord-ID binding)
- Hidden information / per-seat hand zones (PRD §privacy scrubbing)
- Per-seat owned objects (PRD §ownership policy)
- Centralised logging (CloudWatch / Loki)
- Backups (no persistent state to back up)
- Split-origin deployment (S3+CloudFront)
- Self-hosted coturn (documented in `web-rtc.md` as fallback)
- GitHub Actions CI/CD
- Zero-downtime deploys
