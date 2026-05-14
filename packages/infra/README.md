# Infrastructure for Board Together deployment

## Overview

This is the AWS CDK code for the infrastructure behind the Board Together
service. It's split into two stacks:

- `ServerStack` deploys the server-side ECS Fargate task and ALB
- `ClientStack` deploys the client-side S3 + CloudFront distribution

The ALB is configured to redirect HTTP to HTTPS, and the CloudFront
distribution is configured to serve the client app from the S3 bucket.

## Deployment

Ensure the AWS_PROFILE env var is set to the account you want to deploy to.

```
cd packages/infra
npx cdk synth                      # sanity check
npx cdk deploy ServerStack         # ~5–8 min: VPC, ALB, ECS, ACM, Route 53
npx cdk deploy ClientStack         # ~15–25 min: CloudFront is slow
```

## Teardown

```
cd packages/infra
npx cdk destroy ClientStack        # CloudFront removal is slow (~15 min)
npx cdk destroy ServerStack
```

## Validating the deployment

After a successful deploy:

- `curl https://api.playboardgam.es/health` → `200`
- `curl https://api.playboardgam.es/ice-config` → JSON containing your Cloudflare TURN URL
- Browser: `https://playboardgam.es` loads, can create a room
- Browser DevTools → Network: WebSocket to `wss://api.playboardgam.es/...` opens, stays open
- Two browsers in different networks can join the same room and see each other's actions