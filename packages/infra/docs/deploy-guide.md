# Deploy Setup Guide

Step-by-step bootstrap for the [deploy.md](deploy.md) plan. Do steps 1–8 once; step 9 onward is the recurring deploy flow.

## 0. Prereqs

Install locally:

- Node 20+ and npm
- AWS CLI v2 — `aws --version`
- Docker Desktop (running) — needed for CDK `DockerImageAsset` builds
- AWS CDK CLI — `npm i -g aws-cdk` then `cdk --version`

Have ready:

- The domain `playboardgam.es` registered (Route 53 or elsewhere — see step 3)
- A Cloudflare account
- A GitHub repo for this project

---

## 1. Cloudflare Calls TURN

Cloudflare Calls does **not** offer long-lived TURN username/credential pairs.
You provision a TURN App (which gives you a Key ID + API Token), and the server
mints short-lived ICE credentials per session via `generate-ice-servers`. Only
the Key ID and API Token go into SSM.

1. Log in at https://dash.cloudflare.com
2. Left sidebar → **Calls** → **TURN App** → **Create TURN App**
3. Name it (e.g. `board-together-turn`)
4. Open the app, **Create API Token** for it
5. Copy these two values, keep them somewhere safe for step 6:
   - **Turn Token ID** (a.k.a. Key ID — appears in the URL when minting)
   - **API Token** (used as Bearer auth)


### Verifying the credentials work

This is the same call the server makes at runtime — useful to sanity-check
your Key ID + API Token before deploying:

```
curl \
	-H "Authorization: Bearer <api-token>" \
	-H "Content-Type: application/json" -d '{"ttl": 86400}' \
	https://rtc.live.cloudflare.com/v1/turn/keys/<turn-id>/credentials/generate-ice-servers
```

Expected response:

```json
{
  "iceServers": {
    "urls": ["stun:...", "turn:..."],
    "username": "<short-lived>",
    "credential": "<short-lived>"
  }
}
```

---

## 2. AWS account setup

If you already have an AWS account with admin access skip to step 3.

1. Create the AWS account at https://signup.aws.amazon.com (or use an existing one)
2. **Enable MFA on the root user** — IAM → Users → root → Security credentials → Assign MFA
3. Create an IAM admin user for yourself:
   - IAM → Users → Create user → name e.g. `you-admin`
   - Permissions → Attach policies directly → `AdministratorAccess`
   - After creation → Security credentials → Create access key → CLI use
   - Save the access key + secret
4. Configure the CLI:

   ```sh
   aws configure --profile boardtogether
   # AWS Access Key ID:  <paste>
   # AWS Secret Access Key: <paste>
   # Default region: ap-southeast-2
   # Output format: json
   ```

5. Test: `aws sts get-caller-identity --profile boardtogether` → should print your account ID.

> All `aws` and `cdk` commands below assume `--profile boardtogether`. Either pass the flag each time or run `set AWS_PROFILE=boardtogether` (PowerShell: `$env:AWS_PROFILE='boardtogether'`).

---

## 3. Route 53 hosted zone for playboardgam.es

### If the domain is already registered through Route 53

```sh
aws route53 list-hosted-zones-by-name --dns-name playboardgam.es
```

If you see a zone, copy the `Id` (e.g. `/hostedzone/Z123ABC...`). Done.

### If registered elsewhere (Namecheap, Cloudflare Registrar, etc.)

1. Create a hosted zone:

   ```sh
   aws route53 create-hosted-zone --name playboardgam.es --caller-reference $(date +%s)
   ```

2. Copy the 4 `Ns` records from the output.
3. At your registrar, replace the existing nameservers with these 4. DNS propagation: 5 min–48 h.
4. Confirm propagation: `dig NS playboardgam.es` (or `nslookup -type=NS playboardgam.es`) should return the Route 53 nameservers.

---

## 4. CDK bootstrap (both regions)

CDK needs a bootstrap stack in every region+account it deploys into. We use two regions because CloudFront certs must live in `us-east-1`.

```sh
aws sts get-caller-identity --query Account --output text
# remember this ACCOUNT_ID

cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-2
cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

Each bootstrap creates a `CDKToolkit` stack — verify in the AWS Console → CloudFormation in each region.

---

## 5. GitHub OIDC provider + deploy role

Workflows assume an IAM role via OIDC — no long-lived AWS keys in GitHub.

### 5a. Add the OIDC identity provider (once per account)

```sh
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

(If it already exists you'll get an error — safe to ignore.)

### 5b. Create the deploy role

Save this as `trust-policy.json`, replacing `<ACCOUNT_ID>` and `<GH_OWNER>/<REPO>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:<GH_OWNER>/<REPO>:*" }
    }
  }]
}
```

Then:

```sh
aws iam create-role --role-name BoardTogetherDeployRole --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy --role-name BoardTogetherDeployRole --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

> `AdministratorAccess` is broad. Tighten later by scoping to `cloudformation:*`, `ecr:*`, `ecs:*`, `elasticloadbalancing:*`, `s3:*`, `cloudfront:*`, `route53:*`, `ssm:GetParameter*`, `iam:PassRole`, and the CDK-bootstrap role.

Copy the role ARN — you'll paste it into GitHub in step 9.

```sh
aws iam get-role --role-name BoardTogetherDeployRole --query Role.Arn --output text
# arn:aws:iam::<ACCOUNT_ID>:role/BoardTogetherDeployRole
```

---

## 6. SSM SecureString params for TURN

Paste the two Cloudflare values from step 1:

```sh
aws ssm put-parameter --region ap-southeast-2 --type SecureString --name /boardtogether/turn/key_id --value "<turn-token-id>"
aws ssm put-parameter --region ap-southeast-2 --type SecureString --name /boardtogether/turn/api_token --value "<api-token>"
```

The server reads these on container start as `TURN_KEY_ID` and `TURN_API_TOKEN`
and calls Cloudflare's `generate-ice-servers` endpoint to mint per-session ICE
creds (cached in-memory until ~1h before TTL expiry).

Rotate later with `put-parameter --overwrite`. ECS tasks pick up new values on
next deploy (they're not hot-reloaded).

---

## 7. First deploy from your machine

At this point the CDK code (`packages/infra/`) must exist — see [deploy.md](deploy.md) for the code that needs writing first.

```sh
cd packages/infra
npm install
npx cdk synth                      # sanity check
npx cdk deploy ServerStack         # ~5–8 min: VPC, ALB, ECS, ACM, Route 53
npx cdk deploy ClientStack         # ~15–25 min: CloudFront is slow
```

What to verify after each:

- **ServerStack**: `curl https://api.playboardgam.es/health` returns `200 OK`
- **ClientStack**: `https://playboardgam.es` loads the React app

ACM cert validation happens automatically via Route 53 DNS — no manual step.

---

## 8. GitHub Actions config

In the GitHub repo → **Settings** → **Secrets and variables** → **Actions**:

**Repository secrets** (Secrets tab):

- `AWS_DEPLOY_ROLE_ARN` = the role ARN from step 5b

**Repository variables** (Variables tab — not secrets, just config):

- `AWS_REGION_SERVER` = `ap-southeast-2`
- `AWS_REGION_CLIENT` = `us-east-1` *(only if your CDK uses it; the stack itself sets region)*
- `VITE_API_URL` = `https://api.playboardgam.es`
- `ROOT_DOMAIN` = `playboardgam.es`

The workflows reference these via `${{ secrets.AWS_DEPLOY_ROLE_ARN }}` and `${{ vars.VITE_API_URL }}`.

---

## 9. Recurring deploys

### Via GitHub UI

1. Go to **Actions** tab
2. Pick **Deploy Server** or **Deploy Client**
3. Click **Run workflow** → select `main` → **Run workflow**

### Via local CLI

```sh
cd packages/infra
npx cdk deploy ServerStack         # or ClientStack, or --all
```

Both paths produce identical state — CDK is deterministic.

---

## 10. Verification checklist

After a successful deploy:

- `curl https://api.playboardgam.es/health` → `200`
- `curl https://api.playboardgam.es/ice-config` → JSON containing your Cloudflare TURN URL
- Browser: `https://playboardgam.es` loads, can create a room
- Browser DevTools → Network: WebSocket to `wss://api.playboardgam.es/...` opens, stays open
- Two browsers in different networks can join the same room and see each other's actions

---

## 11. Teardown

```sh
cd packages/infra
npx cdk destroy ClientStack        # CloudFront removal is slow (~15 min)
npx cdk destroy ServerStack
```

Manual cleanup (CDK doesn't touch these):

- SSM params: `aws ssm delete-parameters --names /boardtogether/turn/key_id /boardtogether/turn/api_token --region ap-southeast-2`
- IAM role: `aws iam detach-role-policy ... && aws iam delete-role --role-name BoardTogetherDeployRole`
- OIDC provider: leave it (shared, harmless)
- CDK bootstrap stacks: leave them unless you're closing the account
- Route 53 hosted zone: keep it as long as you own the domain

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `cdk deploy` fails with `not bootstrapped` | Missed step 4 for that region |
| ACM cert stuck in `PENDING_VALIDATION` >10 min | Hosted zone NS records not propagated yet (step 3) |
| GH workflow: `Could not assume role` | Trust policy `sub` doesn't match repo, or OIDC provider missing |
| Client loads but WebSocket fails | `VITE_API_URL` wrong at build time, or CORS not added to server |
| TURN not appearing in `/ice-config` | SSM param names mismatch, or task role lacks `ssm:GetParameter` |
| ECS task keeps restarting | Check CloudWatch log group `/ecs/...`; usually a Bun/import error |
