import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface RecorderStackProps extends cdk.StackProps {
  rawBucket: s3.IBucket;
  alertEmail: string;
  /** 10 req/s for the 1st-round capture and soak; 100 on the night (TASK-recorder.md §2.1). */
  rateMax: number;
}

/**
 * One recorder task (architecture.md §4, §10.4): Fargate ARM 0.25 vCPU / 0.5 GB in a public
 * subnet with a public IP (no NAT gateway), S3 via a gateway endpoint. Deploys overlap
 * old and new tasks briefly; the S3 lease makes that harmless.
 */
export class RecorderStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RecorderStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: '/apuracao26/recorder',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    task.addContainer('recorder', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../..'), {
        file: 'apps/recorder/Dockerfile',
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'recorder' }),
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        AWS_REGION: this.region,
        RATE_MAX: String(props.rateMax),
        OBJECT_LOCK_YEARS: '10',
      },
      stopTimeout: cdk.Duration.seconds(30),
    });
    // Least privilege: read/write objects (with retention on raw/ and obs/) and list.
    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectRetention'],
        resources: [props.rawBucket.arnForObjects('*')],
      }),
    );
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [props.rawBucket.bucketArn] }));

    new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
    });

    // Alarms (the full set is Phase 4). Email subscriptions need a one-time confirmation.
    const topic = new sns.Topic(this, 'Alerts', { topicName: 'apuracao26-alerts' });
    topic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const metric = (name: string, dims: Record<string, string>, statistic: string) =>
      new cloudwatch.Metric({ namespace: 'apuracao26', metricName: name, dimensionsMap: { Service: 'recorder', ...dims }, statistic, period: cdk.Duration.minutes(5) });

    // Recorder down, lease lost, or S3 failing: segments stop (a heartbeat is written every 60 s).
    new cloudwatch.Alarm(this, 'RecorderSilent', {
      alarmName: 'apuracao26-recorder-silent',
      alarmDescription: 'No observation segment written for 5 minutes',
      metric: metric('segments_written', {}, 'Sum'),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(new cwActions.SnsAction(topic));

    // The 2nd round appeared at the TSE (auto-discovered).
    for (const election of ['6258', '6260']) {
      new cloudwatch.Alarm(this, `Discovered${election}`, {
        alarmName: `apuracao26-election-${election}-live`,
        alarmDescription: `TSE files for election ${election} are being published; capture samples (runbook)`,
        metric: metric('targets_active', { Election: election }, 'Maximum'),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cwActions.SnsAction(topic));
    }
  }
}
