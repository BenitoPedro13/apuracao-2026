import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { RawStack } from '../lib/raw-stack';
import { RecorderStack } from '../lib/recorder-stack';

const env = { account: '111111111111', region: 'sa-east-1' };
const app = new cdk.App();
const raw = new RawStack(app, 'Raw', { env });
const rec = new RecorderStack(app, 'Rec', { env, rawBucket: raw.bucket, alertEmail: 'test@example.invalid', rateMax: 10 });

test('raw bucket: private, versioned, Object Lock without default retention, retained', () => {
  const t = Template.fromStack(raw);
  t.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      BucketName: 'apuracao26-raw-111111111111',
      ObjectLockEnabled: true,
      ObjectLockConfiguration: Match.absent(),
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    }),
  });
  const rules = Object.values(t.findResources('AWS::S3::Bucket'))[0]!.Properties.LifecycleConfiguration.Rules;
  expect(rules.map((r: { Prefix: string }) => r.Prefix).sort()).toEqual(['lease/', 'state/']);
});

test('recorder: one ARM64 0.25 vCPU / 0.5 GB task, public IP, no NAT gateway', () => {
  const t = Template.fromStack(rec);
  t.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '256',
    Memory: '512',
    RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
  });
  t.hasResourceProperties('AWS::ECS::Service', {
    DesiredCount: 1,
    NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }) },
  });
  t.resourceCountIs('AWS::EC2::NatGateway', 0);
  t.resourceCountIs('AWS::EC2::VPCEndpoint', 1);
});

test('task role can write retention but not delete', () => {
  const policies = Template.fromStack(rec).findResources('AWS::IAM::Policy');
  const actions = JSON.stringify(Object.values(policies).map((p) => p.Properties.PolicyDocument.Statement));
  expect(actions).toContain('s3:PutObjectRetention');
  expect(actions).not.toContain('s3:DeleteObject');
  expect(actions).not.toContain('s3:BypassGovernanceRetention');
});

test('alarms: recorder silent for 5 min, and 2nd-round discovery, to SNS', () => {
  const t = Template.fromStack(rec);
  t.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'apuracao26-recorder-silent',
    Metrics: Match.arrayWith([Match.objectLike({ Expression: 'FILL(m, 0)' })]),
    EvaluationPeriods: 2,
    DatapointsToAlarm: 2,
    Threshold: 1,
    ComparisonOperator: 'LessThanThreshold',
  });
  t.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'test@example.invalid' });
});
