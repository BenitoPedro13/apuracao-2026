import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { ProjectorStack } from '../lib/projector-stack';
import { PublicStack } from '../lib/public-stack';
import { RawStack } from '../lib/raw-stack';
import { RecorderStack } from '../lib/recorder-stack';

const env = { account: '111111111111', region: 'sa-east-1' };

function synth(running: boolean) {
  const app = new cdk.App();
  const raw = new RawStack(app, 'Raw', { env });
  const rec = new RecorderStack(app, 'Rec', { env, rawBucket: raw.bucket, alertEmail: 'test@example.invalid', rateMax: 10 });
  const pub = new PublicStack(app, 'Pub', { env, cdn: false });
  const stack = new ProjectorStack(app, 'Proj', {
    env,
    rawBucket: raw.bucket,
    pubBucket: pub.bucket,
    cluster: rec.cluster,
    elections: 'president=6258,governor=6260',
    epoch: '2t-1',
    promote: false,
    running,
  });
  return Template.fromStack(stack);
}

test('projector: ARM64 0.5 vCPU / 1 GB, 0 tasks unless switched on', () => {
  const off = synth(false);
  off.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '512',
    Memory: '1024',
    RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    ContainerDefinitions: [
      Match.objectLike({
        Environment: Match.arrayWith([
          { Name: 'ELECTIONS', Value: 'president=6258,governor=6260' },
          { Name: 'EPOCH', Value: '2t-1' },
          { Name: 'PROMOTE', Value: 'false' },
        ]),
      }),
    ],
  });
  off.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 0 });
  synth(true).hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
});

test('projector role: writes to the raw bucket only its checkpoints and lease; never deletes; no test key', () => {
  const t = synth(false);
  const statements = Object.values(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[]);
  const putResources = statements
    .filter((s) => [s.Action].flat().includes('s3:PutObject'))
    .flatMap((s) => [s.Resource].flat())
    .map((r) => JSON.stringify(r));
  // On the raw bucket: exactly the checkpoints prefix and the lease key. The rest is the public bucket.
  const raw = putResources.filter((r) => r.includes('Raw'));
  expect(raw).toHaveLength(2);
  expect(raw.every((r) => r.endsWith('/checkpoints/projector/*"]]}') || r.endsWith('/lease/projector.json"]]}'))).toBe(true);
  expect(putResources.filter((r) => !r.includes('Raw')).every((r) => r.includes('Pub'))).toBe(true);
  expect(JSON.stringify(statements)).not.toContain('s3:DeleteObject');
  expect(JSON.stringify(t.toJSON())).not.toContain('TSE_TEST_JWK_URL');
});
