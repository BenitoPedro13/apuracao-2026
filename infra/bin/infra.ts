#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BudgetStack } from '../lib/budget-stack';

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
