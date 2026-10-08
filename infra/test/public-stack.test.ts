import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { PublicStack } from '../lib/public-stack';

const env = { account: '111111111111', region: 'sa-east-1' };
const t = Template.fromStack(new PublicStack(new cdk.App(), 'Pub', { env }));

test('public bucket: private, unversioned, retained, no public policy', () => {
  t.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      BucketName: 'apuracao26-pub-111111111111',
      VersioningConfiguration: Match.absent(),
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    }),
  });
  // Every Allow is to CloudFront (OAC); the only "*" principal is enforceSSL's Deny.
  const statements = Object.values(t.findResources('AWS::S3::BucketPolicy')).flatMap(
    (p) => p.Properties.PolicyDocument.Statement as { Effect: string; Principal: unknown }[],
  );
  const allows = statements.filter((s) => s.Effect === 'Allow');
  expect(allows.length).toBeGreaterThan(0);
  expect(allows.every((s) => JSON.stringify(s.Principal) === '{"Service":"cloudfront.amazonaws.com"}')).toBe(true);
});

test('distribution: one OAC origin with Origin Shield in sa-east-1, Price Class All, CachingOptimized, compression', () => {
  t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  t.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      PriceClass: 'PriceClass_All',
      HttpVersion: 'http2and3',
      DefaultRootObject: 'index.html',
      Origins: [Match.objectLike({ OriginShield: { Enabled: true, OriginShieldRegion: 'sa-east-1' }, OriginAccessControlId: Match.anyValue() })],
      DefaultCacheBehavior: Match.objectLike({
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
        Compress: true,
        ViewerProtocolPolicy: 'redirect-to-https',
      }),
      WebACLId: Match.absent(),
    }),
  });
});

test('error responses are never cached (TTL 0 for 403/404/5xx)', () => {
  const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0]!;
  const errors = dist.Properties.DistributionConfig.CustomErrorResponses as { ErrorCode: number; ErrorCachingMinTTL: number }[];
  expect(errors.map((e) => e.ErrorCode).sort()).toEqual([403, 404, 500, 502, 503, 504]);
  expect(errors.every((e) => e.ErrorCachingMinTTL === 0)).toBe(true);
});
