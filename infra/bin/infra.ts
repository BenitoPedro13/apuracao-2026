#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BudgetStack } from '../lib/budget-stack';
import { ProjectorStack } from '../lib/projector-stack';
import { PublicStack } from '../lib/public-stack';
import { RawStack } from '../lib/raw-stack';
import { RecorderStack } from '../lib/recorder-stack';

const app = new cdk.App();

// Everything runs in sa-east-1 (architecture.md §11). Budgets are account-wide.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'sa-east-1' };

// The alert address comes from the environment, so it never lands in the repo. Required on
// every synth, so a deploy can never go out with a placeholder address (the build script
// passes an explicit .invalid one).
const alertEmail = process.env.ALERT_EMAIL;
if (!alertEmail) {
  throw new Error('ALERT_EMAIL is not set (see .env.example)');
}

new BudgetStack(app, 'BudgetStack', { env, alertEmail });
const raw = new RawStack(app, 'RawStack', { env });
const recorder = new RecorderStack(app, 'RecorderStack', { env, rawBucket: raw.bucket, alertEmail, rateMax: 10 });
const pub = new PublicStack(app, 'PublicStack', { env });
// The projector runs only when switched on (-c projector=on): from 10-18 for the night, on
// the 2nd round under epoch 2t-1, promoted over the 1st-round seed when 6258 appears
// (TASK-public-cdn.md §6).
new ProjectorStack(app, 'ProjectorStack', {
  env,
  rawBucket: raw.bucket,
  pubBucket: pub.bucket,
  cluster: recorder.cluster,
  elections: app.node.tryGetContext('elections') ?? 'president=6258,governor=6260',
  epoch: app.node.tryGetContext('epoch') ?? '2t-1',
  promote: app.node.tryGetContext('promote') === 'true',
  running: app.node.tryGetContext('projector') === 'on',
});
