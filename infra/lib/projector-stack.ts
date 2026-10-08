import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface ProjectorStackProps extends cdk.StackProps {
  rawBucket: s3.IBucket;
  pubBucket: s3.IBucket;
  cluster: ecs.ICluster;
  /** `president=6258,governor=6260` on the night (TASK-public-cdn.md §6). */
  elections: string;
  epoch: string;
  /** Replace a pointer of another epoch (the runbook's switch from the 1st-round seed). */
  promote: boolean;
  /** Run the task (context `projector=on`). Off: the service exists with 0 tasks. */
  running: boolean;
}

/**
 * The primary projector (architecture.md §5.4, TASK-public-cdn.md §2.2): Fargate ARM
 * 0.5 vCPU / 1 GB in the recorder's VPC and cluster, S3 mode. Billed only while running.
 */
export class ProjectorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProjectorStackProps) {
    super(scope, id, props);

    const task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: '/apuracao26/projector',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    task.addContainer('projector', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../..'), {
        file: 'apps/projector/Dockerfile',
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'projector' }),
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        PUB_BUCKET: props.pubBucket.bucketName,
        AWS_REGION: this.region,
        ELECTIONS: props.elections,
        EPOCH: props.epoch,
        PROMOTE: String(props.promote),
      },
      stopTimeout: cdk.Duration.seconds(30),
    });

    // Least privilege: read the whole raw log, write only its own checkpoints and lease
    // (never raw/, obs/ or the recorder's lease); read/write the public bucket.
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [props.rawBucket.arnForObjects('*')] }));
    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [props.rawBucket.arnForObjects('checkpoints/projector/*'), props.rawBucket.arnForObjects('lease/projector.json')],
      }),
    );
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [props.rawBucket.bucketArn, props.pubBucket.bucketArn] }));
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:PutObject'], resources: [props.pubBucket.arnForObjects('*')] }));

    new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition: task,
      desiredCount: props.running ? 1 : 0,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
    });
  }
}
