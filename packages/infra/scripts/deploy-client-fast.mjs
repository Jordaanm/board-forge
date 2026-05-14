#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir   = resolve(__dirname, '../../client/dist');
const stackName = 'ClientStack';
const region    = 'ap-southeast-2';

if (!existsSync(distDir)) {
  console.error(`dist not found: ${distDir}\nRun: npm run build --workspace=packages/client`);
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: ['inherit', 'pipe', 'inherit'] }).toString().trim();
const sh  = (cmd) => execSync(cmd, { stdio: 'inherit' });

console.log(`Fetching outputs from ${stackName}...`);
const outputsJson = run(
  `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --query "Stacks[0].Outputs" --output json`
);
const outputs = JSON.parse(outputsJson);
const get = (k) => outputs.find((o) => o.OutputKey === k)?.OutputValue;

const bucket         = get('BucketName');
const distributionId = get('DistributionId');

if (!bucket || !distributionId) {
  console.error('Missing BucketName or DistributionId in stack outputs.');
  process.exit(1);
}

console.log(`Syncing ${distDir} -> s3://${bucket} ...`);
sh(`aws s3 sync "${distDir}" "s3://${bucket}" --delete`);

console.log(`Invalidating CloudFront ${distributionId} ...`);
sh(`aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`);

console.log('Done.');
