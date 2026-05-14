#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ServerStack } from '../lib/server-stack';
import { ClientStack } from '../lib/client-stack';

const app = new cdk.App();

const account    = process.env.CDK_DEFAULT_ACCOUNT;
const rootDomain = 'playboardgam.es';
const apiDomain  = `api.${rootDomain}`;

new ServerStack(app, 'ServerStack', {
  env: { account, region: 'ap-southeast-2' },
  crossRegionReferences: true,
  rootDomain,
  apiDomain,
});

new ClientStack(app, 'ClientStack', {
  env: { account, region: 'ap-southeast-2' },
  crossRegionReferences: true,
  rootDomain,
});
