import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * The fan-out (architecture.md §6, TASK-public-cdn.md §2.1): a private bucket behind one
 * CloudFront distribution. Every object carries its own Cache-Control from the publisher,
 * so one managed policy (CachingOptimized, which honours it from 1 s up) covers every path.
 */
export interface PublicStackProps extends cdk.StackProps {
  /**
   * false (plan B, TASK-public-cdn.md §8): no distribution while AWS verifies the account
   * for CloudFront; readers GET the objects anonymously over the bucket's HTTPS endpoint.
   */
  cdn: boolean;
}

export class PublicStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly distribution?: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: PublicStackProps) {
    super(scope, id, props);
    // Unversioned: views and manifests are write-once; the pointer's history is the manifests.
    this.bucket = new s3.Bucket(this, 'Pub', {
      bucketName: `apuracao26-pub-${this.account}`,
      // Plan B lets a bucket policy grant public reads; ACLs stay blocked either way.
      blockPublicAccess: props.cdn
        ? s3.BlockPublicAccess.BLOCK_ALL
        : new s3.BlockPublicAccess({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: false, restrictPublicBuckets: false }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // The data is public anyway; this lets the web app run from localhost against it.
      cors: props.cdn ? undefined : [{ allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD], allowedOrigins: ['*'], maxAge: 3000 }],
    });
    new cdk.CfnOutput(this, 'PubBucketName', { value: this.bucket.bucketName });

    if (!props.cdn) {
      // Reads only, no listing: a missing key is a 403, and writes stay the projector's.
      this.bucket.addToResourcePolicy(
        new iam.PolicyStatement({ actions: ['s3:GetObject'], principals: [new iam.AnyPrincipal()], resources: [this.bucket.arnForObjects('*')] }),
      );
      new cdk.CfnOutput(this, 'PublicBaseUrl', { value: `https://${this.bucket.bucketRegionalDomainName}/` });
      return;
    }

    // Error caching is per distribution, not per path: TTL 0 so a transient error or a
    // not-yet-uploaded key is never served from cache (architecture.md §6.1 item 5).
    const errorResponses = [403, 404, 500, 502, 503, 504].map((httpStatus) => ({ httpStatus, ttl: cdk.Duration.seconds(0) }));

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
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

    this.distribution = distribution;
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
  }
}
