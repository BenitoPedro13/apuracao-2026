import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * The fan-out (architecture.md §6, TASK-public-cdn.md §2.1): a private bucket behind one
 * CloudFront distribution. Every object carries its own Cache-Control from the publisher,
 * so one managed policy (CachingOptimized, which honours it from 1 s up) covers every path.
 */
export class PublicStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Unversioned: views and manifests are write-once; the pointer's history is the manifests.
    this.bucket = new s3.Bucket(this, 'Pub', {
      bucketName: `apuracao26-pub-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Error caching is per distribution, not per path: TTL 0 so a transient error or a
    // not-yet-uploaded key is never served from cache (architecture.md §6.1 item 5).
    const errorResponses = [403, 404, 500, 502, 503, 504].map((httpStatus) => ({ httpStatus, ttl: cdk.Duration.seconds(0) }));

    this.distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'apuracao26 public views and site',
      defaultBehavior: {
        // READ + LIST: a missing key is a 404, not a 403.
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket, {
          originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
          originShieldEnabled: true,
          originShieldRegion: 'sa-east-1',
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },
      // Only Price Class All has South American edges, where every viewer is.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultRootObject: 'index.html',
      errorResponses,
    });

    new cdk.CfnOutput(this, 'PubBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: this.distribution.distributionDomainName });
  }
}
