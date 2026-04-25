# WebRTC — Plan

## Current State

App already uses WebRTC data channels for all game state. WebSockets are signaling-only.

- `packages/client/src/net/ConnectionManager.ts` — creates `RTCPeerConnection`, opens a `game` data channel, sends/receives JSON game messages
- `packages/server/src/signaling.ts` + `rooms.ts` — WebSocket server forwards `join`/`offer`/`answer`/`ice-candidate` between host and one guest, nothing else
- ICE config: Google STUN only (`stun.l.google.com:19302`)
- Room capacity: host + 1 guest

No migration needed. Remaining work is making P2P production-viable.

## Gaps

1. No TURN — ~15–20% of real users behind symmetric NAT / restrictive firewalls fail to connect
2. 2-peer cap — scene is host+guest only
3. No host migration — host drop kills the room
4. Room IDs unauthenticated and likely guessable
5. Current offer/answer flow can't handle renegotiation or glare
6. Data channel reliability/ordering left at defaults — physics patches should be unreliable+unordered

## Required Services

### Signaling (still required)
WebRTC needs an out-of-band rendezvous to exchange SDP + ICE. Can't remove it.

- Keep existing Bun/`ws` server, or port to API Gateway WebSocket + Lambda
- Traffic is tiny (KBs per session), so a t3.micro or Fargate Spot task covers the PoC

### TURN (new)
Required for peers whose NAT blocks direct P2P. TURN relays every packet, so it bills on bandwidth.

Options:
- **Self-hosted coturn** on EC2 (t3.micro, Elastic IP, UDP 3478 + TCP/TLS 443 fallback). Cheapest at small scale.
- **Managed**: Twilio NTS, Xirsys, Cloudflare Calls TURN. ~$0.40–0.80/GB relayed. Zero ops.

Credentials must be short-lived (HMAC, TTL ≤ 24h) and issued by the signaling server — never bake static creds into the client.

### STUN
Google STUN is fine for PoC. For reliability, self-host via same coturn box.

## Migration Steps

### 1. TURN integration
- Deploy coturn (or pick managed provider)
- Add `GET /ice-config` to signaling server — returns `RTCIceServer[]` with time-limited TURN credentials
- Client fetches before `new RTCPeerConnection(...)`
- Test with forced-relay (`iceTransportPolicy: 'relay'`) in dev

### 2. Multi-peer rooms
Current `rooms.ts` hardcodes `host` + `guest`. Replace with a peer list.

Topology choice:
- **Star (host-authoritative)** — matches current HostReplicator model. Host opens one `RTCPeerConnection` per guest; guests only connect to host. Scales to ~20 peers before host uplink saturates.
- **Mesh** — O(n²) connections, better fault tolerance, fine up to ~6 peers.

Recommend star — physics is host-authoritative anyway.

Signaling changes:
- `join` returns list of existing peer IDs
- Forward signaling by `peerId`, not host↔guest
- New `peer-left` message for cleanup

### 3. Host migration
- Host sends periodic full snapshots to all guests (already in `HostReplicator`)
- On host drop: signaling server promotes the oldest remaining peer; new host resumes from last snapshot, renegotiates data channels with remaining guests
- Physics state is deterministic enough that a snapshot handoff is fine for PoC

### 4. Security
- Room IDs: 128-bit crypto RNG, base64url
- Optional room password: signaling server HMACs password and only forwards SDP if hash matches
- Rate-limit `join` by IP

### 5. Perfect negotiation
Replace current manual offer/answer with the [MDN perfect-negotiation pattern](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation). Handles renegotiation (needed when peers join/leave in star topology) and glare.

### 6. Data channel tuning
Two channels instead of one:
- `state` — `ordered: false, maxRetransmits: 0` for physics patches (stale = discard)
- `rpc` — default reliable+ordered for snapshots, context-menu actions, spawn/despawn

## AWS Deployment

| Component | Service | Notes |
|-----------|---------|-------|
| Client | S3 + CloudFront | already the plan |
| Signaling | Fargate task or t3.micro EC2 | behind ALB for TLS/WSS |
| TURN | EC2 + coturn | Elastic IP, UDP 3478 + TCP 443 TLS fallback, SG open to 0.0.0.0/0 on those ports |
| ICE credential endpoint | Signaling server | HMAC with TURN static-auth-secret, 1h TTL |

### Cost ballpark (PoC)
- Signaling: ~$10/mo (Fargate Spot) or $0 co-located on existing box
- TURN box: ~$8/mo (t3.micro) + egress
- TURN egress: ~$0.09/GB AWS out. Expect 30–100 KB/s per relayed peer → ~300 MB/hr/peer worst case
- Managed TURN alternative: ~$0.40/GB relayed, no ops

## STUN/TURN for Production

Current setup uses Google's public STUN only — no TURN, so peers behind symmetric NAT or strict corporate firewalls fail outright. Production needs both.

### Why both
- **STUN** — peers discover their public-facing `host:port` and attempt direct P2P. Cheap (single UDP exchange), no relay traffic.
- **TURN** — fallback relay when STUN-discovered candidates can't connect. Every packet flows through the server, so it bills on bandwidth.

WebRTC's ICE agent tries STUN candidates first and only falls back to TURN if needed. Expect ~80–85% of sessions to succeed via STUN, ~15–20% to require TURN relay.

### Service recommendations

**Option A — Managed (recommended for launch)**

| Provider | Pricing | Notes |
|----------|---------|-------|
| Cloudflare Calls TURN | $0.05/GB relayed | Cheapest by ~10×. Free STUN. Anycast endpoints. |
| Twilio Network Traversal Service | ~$0.40/GB | Mature, multi-region, easy creds API |
| Xirsys | ~$0.50/GB tiered | Per-channel pricing, global PoPs |
| Metered.ca | ~$0.40/GB | Simple flat pricing, free dev tier |

Pick **Cloudflare Calls** unless you already have a Twilio account — pricing gap is large and Cloudflare's anycast handles geo-routing automatically.

**Option B — Self-hosted coturn**

EC2 t3.small + Elastic IP, ~$15/mo fixed + $0.09/GB egress. Cheaper than managed once relay traffic exceeds ~150 GB/mo. Worth it only after traffic justifies the ops burden (cert renewal, monitoring, scaling).

Multi-region requires one coturn per region + GeoDNS routing — significant ops cost; defer until users complain about latency.

### Implementation

1. **Credential endpoint** — `GET /ice-config` on signaling server returns `RTCIceServer[]` with TTL ≤ 1h. For coturn use HMAC-SHA1 over `expiry:username` with the static-auth-secret. For managed providers, hit their creds API server-side and forward.
2. **Client fetches before peer connection** — `await fetch('/ice-config')` then pass to `new RTCPeerConnection({ iceServers })`. Refresh on `iceconnectionstatechange === 'failed'`.
3. **Never embed static creds** — leaked creds = unmetered relay bandwidth on your bill.
4. **Force-relay testing** — `iceTransportPolicy: 'relay'` in dev to verify TURN path actually works before shipping. Most TURN bugs only surface when STUN succeeds and TURN is never exercised.
5. **Multiple ICE servers** — list both UDP/3478 and TCP/TLS/443 entries so corporate firewalls that block UDP still get a path.

### Cost estimate

Assume star topology, host uploads ~50 KB/s of state per guest. 4-player session, 2hr avg, 20% TURN-relayed:
- Direct: 0 relay cost
- Relayed peer: ~360 MB/session relayed
- Sessions/month at 1k DAU, 1 session/day: ~30k → ~6k relayed → ~2.1 TB

At Cloudflare $0.05/GB: ~$105/mo. At Twilio $0.40/GB: ~$840/mo. Self-hosted coturn: ~$15 fixed + ~$190 egress = ~$205/mo.

Crossover where self-hosted beats Cloudflare is around 4 TB/mo relayed. Stay managed until then.

### Current toggle (in-tree)

ICE config is wired but TURN is off by default — no provider commitment until needed.

- Server reads `STUN_URLS`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` env vars (`packages/server/src/config.ts`)
- `GET /ice-config` returns `{ iceServers }` (`packages/server/src/app.ts`)
- Client fetches before opening peer connections; falls back to Google STUN if endpoint unreachable (`packages/client/src/net/ConnectionManager.ts`)
- To enable TURN: set the three `TURN_*` vars on the signaling server. No client change needed.
- Static creds via env are PoC-only; for production swap `getIceServers()` to mint short-lived HMAC creds per request.

## Out of Scope

- SFU / media forwarding (no audio/video yet)
- End-to-end encryption beyond DTLS (data channels are already encrypted)
- Cross-region TURN (single region until there's demand)
