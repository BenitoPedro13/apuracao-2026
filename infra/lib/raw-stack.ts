import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * The raw log (architecture.md §5.1): every TSE file version, kept forever.
 * Object Lock is enabled with no default retention: the recorder sets governance-mode
 * retention per object on raw/ and obs/ only, so lease/ and state/ (overwritten every few
 * seconds) aren't locked for 10 years. Their old versions expire after a day.
 */
export class RawStack extends cdk.Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.bucket = new s3.Bucket(this, 'Raw', {
      bucketName: `apuracao26-raw-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: ['lease/', 'state/'].map((prefix) => ({
        id: `expire-old-${prefix.replace('/', '')}-versions`,
        prefix,
        noncurrentVersionExpiration: cdk.Duration.days(1),
      })),
    });
    new cdk.CfnOutput(this, 'RawBucketName', { value: this.bucket.bucketName });
  }
}
