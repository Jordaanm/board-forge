# Discord OAuth — operator setup

One-time provisioning for the `POST /oauth/discord/exchange` endpoint.

## 1. Discord developer portal

App: <https://discord.com/developers/applications> → your Board Together app.

- **Client ID:** `1052577838978580540`
- **OAuth2 → Redirects** — both URIs must be registered:
  - `http://localhost:5173/auth/discord/callback`
  - `https://playboardgam.es/auth/discord/callback`
- **OAuth2 scopes:** `identify` (RPC consent comes via the AUTHORIZE flow at runtime in issue #7)
- **Client secret:** OAuth2 → Reset Secret. Copy once — never committed.

## 2. Local dev

```pwsh
cp packages/server/.env.local.example packages/server/.env.local
```

Edit `packages/server/.env.local` and paste `DISCORD_CLIENT_SECRET`. The file is gitignored (`*.local`).

Client side: `packages/client/.env.example` already has `VITE_DISCORD_CLIENT_ID` baked in; copy to `.env` if not already done.

## 3. Production (AWS SSM SecureString)

Region: `ap-southeast-2` (matches `ServerStack`).

```pwsh
aws ssm put-parameter `
  --name /boardtogether/discord/client_id `
  --type SecureString `
  --value 1052577838978580540 `
  --region ap-southeast-2

aws ssm put-parameter `
  --name /boardtogether/discord/client_secret `
  --type SecureString `
  --value <PASTE_SECRET> `
  --region ap-southeast-2
```

Then `cdk deploy ServerStack` — the task definition picks the parameters up via `ecs.Secret.fromSsmParameter`.

`DISCORD_REDIRECT_URI_ALLOWLIST` is set as a plain task env var by the stack (`https://playboardgam.es/auth/discord/callback`); no SSM entry needed.

## 4. Smoke test

After `bun run dev` in `packages/server`:

```pwsh
curl -X POST http://localhost:3001/oauth/discord/exchange `
  -H 'Content-Type: application/json' `
  -d '{\"grant_type\":\"authorization_code\",\"code\":\"<REAL_CODE>\",\"code_verifier\":\"<VERIFIER>\",\"redirect_uri\":\"http://localhost:5173/auth/discord/callback\"}'
```

Expected: `200 { access_token, refresh_token, expires_in }`. Real auth codes are single-use — re-run the OAuth flow to get a fresh one.

Negative cases worth a manual hit:
- Drop `code_verifier` → `400 { error: 'invalid_request' }`
- `redirect_uri: https://evil.example.com/cb` → `400 { error: 'redirect_uri_not_allowed' }`
- Stale `code` → `400 { error: 'invalid_grant', error_description: ... }` (Discord's response, sanitised passthrough)

## 5. Rotation

Reset the secret in the Discord portal, then re-run the `put-parameter` for `/boardtogether/discord/client_secret` and force a new ECS task (`aws ecs update-service --force-new-deployment`). No code change needed.
