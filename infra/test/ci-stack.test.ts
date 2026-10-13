import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { CiStack } from '../lib/ci-stack';

const env = { account: '111111111111', region: 'sa-east-1' };
const app = new cdk.App();
const t = Template.fromStack(new CiStack(app, 'Ci', { env, subjectPrefix: 'repo:owner@1/repo@2' }));

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statements = (): Statement[] =>
  Object.values(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement as Statement[]);
const actionsOf = (s: Statement) => ([] as string[]).concat(s.Action);

test('the provider is GitHub Actions, for the STS audience only', () => {
  t.resourceCountIs('AWS::IAM::OIDCProvider', 1);
  t.hasResourceProperties('AWS::IAM::OIDCProvider', { Url: 'https://token.actions.githubusercontent.com', ClientIdList: ['sts.amazonaws.com'] });
});

test('only a run on main of this repository can assume the role, for one hour', () => {
  t.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'apuracao26-web-deploy',
    MaxSessionDuration: 3600,
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Effect: 'Allow',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub': 'repo:owner@1/repo@2:ref:refs/heads/main',
            },
          },
        }),
      ],
    },
  });
});

test('it refers to the public bucket by name, so it never depends on PublicStack', () => {
  expect(JSON.stringify(statements())).toContain(':s3:::apuracao26-pub-111111111111/');
  expect(JSON.stringify(t.toJSON())).not.toContain('GetStackOutput');
});

test('the role can put objects and read the pointer; nothing else (no delete, no listing)', () => {
  const allowed = statements().filter((s) => s.Effect === 'Allow').flatMap(actionsOf).sort();
  expect(allowed).toEqual(['s3:GetObject', 's3:PutObject']);
});

test('the one object it may read is the pointer the deploy script checks', () => {
  const read = statements().find((s) => actionsOf(s).includes('s3:GetObject'))!;
  expect(JSON.stringify(read.Resource)).toContain('/data/v1/latest.json');
});

test('writes under data/ are denied explicitly: it is the projector\'s', () => {
  const deny = statements().filter((s) => s.Effect === 'Deny');
  expect(deny).toHaveLength(1);
  expect(actionsOf(deny[0]!)).toContain('s3:PutObject');
  expect(JSON.stringify(deny[0]!.Resource)).toContain('/data/*');
});
