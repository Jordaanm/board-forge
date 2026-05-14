# Deployment Plan

## Topology

- Apex `https://playboardgam.es` → S3 + CloudFront (client)
- `https://api.playboardgam.es` → ALB → Fargate 1 task (server, WS + HTTP)
- Cloudflare Calls TURN, Key ID + API Token in SSM SecureString; server mints short-lived ICE creds on demand and caches them

## Regions

- Server stack: `ap-southeast-2` (Sydney)
- Client stack: bucket + distribution in `ap-southeast-2`, CloudFront cert in `us-east-1` (mandatory), cross-region refs in CDK

## Server

- ECS Fargate, 0.25 vCPU / 0.5 GB, public subnet + public IP (no NAT, saves ~$32/mo)
- ALB w/ ACM cert, target group health-check `/health`, WS-compatible listener
- `DockerImageAsset` builds & pushes `oven/bun` image during `cdk deploy`
- Logs → CloudWatch, 14-day retention
- Single task → sticky sessions moot for now; in-memory room state breaks if scaled to N>1

## Client

- S3 bucket (private, OAC) + CloudFront, SPA fallback (403/404 → `/index.html`)
- Route 53 ALIAS at apex → CloudFront
- `VITE_API_URL=https://api.playboardgam.es` baked at build time by workflow

## IaC

- `packages/infra/` (new workspace), CDK TS, two stacks: `ServerStack`, `ClientStack`, one app, `crossRegionReferences: true`

## CI/CD

- GH OIDC → IAM role (one-time bootstrap)
- Two workflows, `workflow_dispatch` only:
  - `deploy-server.yml`: typecheck → `cdk deploy ServerStack`
  - `deploy-client.yml`: typecheck → set `VITE_API_URL` → build → `cdk deploy ClientStack`
- Local fallback: `cd packages/infra && npx cdk deploy <Stack>` works identically

## Code changes needed

- `packages/client/src/pages/Landing.tsx:6` and `packages/client/src/pages/Room.tsx:40`: replace hardcoded `localhost:3001` with `import.meta.env.VITE_API_URL` (+ derive `wss://` from it)
- New `packages/server/Dockerfile` (Bun base, multi-stage)
- Add CORS middleware to `packages/server/src/app.ts` allowing `https://playboardgam.es`

## One-time bootstrap

1. `cdk bootstrap` in both `ap-southeast-2` and `us-east-1`
2. Create GH OIDC provider + deploy role (CDK can do this in a third tiny `BootstrapStack`, or by hand once)
3. Put Cloudflare TURN Key ID + API Token into SSM as `/boardtogether/turn/key_id` and `/boardtogether/turn/api_token` (both SecureString)
4. Confirm Route 53 hosted zone for `playboardgam.es` exists

## Expected cost

~$25–35/mo (ALB ~$16–22, Fargate ~$8.50, rest negligible)

## Flagged for later, not blocking

- WebSocket `Origin` validation on the server (currently any-origin)
- Client refresh of ICE creds mid-session (currently fetched once on room join; sessions >24h would see TURN creds expire — peers reconnecting refetch, so this is only an issue for unbroken long-lived peer connections)
- If scaling to N>1 server tasks, move room state to Redis/DDB before doing so

## Decision log

| Decision | Choice |
|---|---|
| Scale | Small + ongoing (20–100 testers, weeks–months) |
| Server host | ECS Fargate + ALB |
| Domain | playboardgam.es in Route 53 |
| IaC | AWS CDK (TypeScript) |
| Stack split | Two stacks, one CDK app |
| Infra location | `packages/infra/` |
| GHA auth | OIDC role assumption |
| DNS layout | Apex for client, `api.` subdomain for server |
| TURN | Cloudflare Calls (dynamic creds minted per-session, cached in-memory) |
| Secrets | SSM Parameter Store SecureString (Key ID + API Token only) |
| Triggers | Manual `workflow_dispatch` only |
| Networking | Public subnet, no NAT |
| Image build | CDK `DockerImageAsset` |
| Region | `ap-southeast-2` (client cert in `us-east-1`) |
| Client env | Workflow sets `VITE_API_URL` from constant |
| Deploy gating | Typecheck only |
| Log retention | 14 days |
