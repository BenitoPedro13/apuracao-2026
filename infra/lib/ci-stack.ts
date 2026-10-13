import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * What GitHub Actions may do in this account (TASK-ci-deploy.md §2.1): publish the web
 * export to the public bucket, nothing else. No access keys exist anywhere: the workflow
 * trades GitHub's OIDC token for a one-hour session on this role.
 */
export interface CiStackProps extends cdk.StackProps {
  /**
   * The repository's OIDC subject prefix: `repo:<owner>@<owner id>/<name>@<repo id>` when the
   * repository uses immutable subjects (GitHub's default for new repositories), else
   * `repo:<owner>/<name>`. Read it with `gh api repos/<owner>/<name>/actions/oidc/customization/sub`
   * (`sub_claim_prefix`). With IDs, a repository recreated under the same name doesn't inherit
   * the trust.
   */
  subjectPrefix: string;
}

export class CiStack extends cdk.Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    // By name (as PublicStack builds it), not by reference: this stack stays independent, so
    // deploying it never touches PublicStack, which serves the site.
    const pubBucket = s3.Bucket.fromBucketName(this, 'Pub', `apuracao26-pub-${this.account}`);

    // One provider per URL per account; none existed when this was written (checked with
    // `aws iam list-open-id-connect-providers`, 2026-10-13). AWS validates GitHub's certificate
    // against its trusted CAs, so no thumbprint is pinned.
    const provider = new iam.OidcProviderNative(this, 'GitHub', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // Only a run on `main` of this repository (the first version assumed `repo:owner/name`; this
    // repository's tokens carry the immutable form and were refused, 2026-10-13): pull requests (forks included) and other
    // branches carry a different `sub` and can't assume it. Jobs must not use a GitHub
    // `environment:`, which would change the subject.
    this.role = new iam.Role(this, 'WebDeploy', {
      roleName: 'apuracao26-web-deploy',
      description: 'GitHub Actions: publishes apps/web/out to the public bucket (TASK-ci-deploy.md)',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `${props.subjectPrefix}:ref:refs/heads/main`,
        },
      }),
    });

    // What scripts/deploy-web.ts does: PutObject per file, and a HEAD of the pointer, data/v1/latest.json (which
    // needs GetObject) before and after. No delete, no listing, no other bucket, no other service.
    // (Explicit, not grantPut(): that adds retention, legal-hold and tagging actions we don't use.)
    this.role.addToPolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [pubBucket.arnForObjects('*')] }));
    this.role.addToPolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [pubBucket.arnForObjects('data/v1/latest.json')] }),
    );
    // data/ is the projector's: the deploy script refuses to touch it, and so does the role.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:DeleteObject', 's3:AbortMultipartUpload'],
        resources: [pubBucket.arnForObjects('data/*')],
      }),
    );

    new cdk.CfnOutput(this, 'WebDeployRoleArn', { value: this.role.roleArn });
  }
}
