import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface ServerStackProps extends cdk.StackProps {
  rootDomain: string;
  apiDomain:  string;
}

export class ServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServerStackProps) {
    super(scope, id, props);

    const { rootDomain, apiDomain } = props;

    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: rootDomain });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs:      2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    const cluster = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc,
      allowAllOutbound: true,
      description:      'Fargate service SG',
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      allowAllOutbound: true,
      description:      'ALB SG',
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80),  'http');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'https');

    cluster.addIngressRule(albSg, ec2.Port.tcp(3001), 'alb to task');

    const ecsCluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const image = new ecr_assets.DockerImageAsset(this, 'ServerImage', {
      directory: path.join(__dirname, '..', '..', 'server'),
      platform:  ecr_assets.Platform.LINUX_AMD64,
    });

    const logGroup = new logs.LogGroup(this, 'ServerLogs', {
      logGroupName:  '/ecs/board-together-server',
      retention:     logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const turnKeyId         = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'TurnKeyId',          { parameterName: '/boardtogether/turn/key_id' });
    const turnApiTok        = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'TurnApiToken',       { parameterName: '/boardtogether/turn/api_token' });
    const discordClientId   = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'DiscordClientId',    { parameterName: '/boardtogether/discord/client_id' });
    const discordClientSec  = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'DiscordClientSecret', { parameterName: '/boardtogether/discord/client_secret' });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu:            256,
      memoryLimitMiB: 512,
    });

    taskDef.addContainer('server', {
      image:        ecs.ContainerImage.fromDockerImageAsset(image),
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      logging:      ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'server' }),
      environment:  {
        NODE_ENV: 'production',
        PORT:     '3001',
        DISCORD_REDIRECT_URI_ALLOWLIST: `https://${rootDomain}/auth/discord/callback`,
      },
      secrets: {
        TURN_KEY_ID:           ecs.Secret.fromSsmParameter(turnKeyId),
        TURN_API_TOKEN:        ecs.Secret.fromSsmParameter(turnApiTok),
        DISCORD_CLIENT_ID:     ecs.Secret.fromSsmParameter(discordClientId),
        DISCORD_CLIENT_SECRET: ecs.Secret.fromSsmParameter(discordClientSec),
      },
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster:           ecsCluster,
      taskDefinition:    taskDef,
      desiredCount:      1,
      assignPublicIp:    true,
      vpcSubnets:        { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups:    [cluster],
      circuitBreaker:    { rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    });

    const cert = new acm.Certificate(this, 'ApiCert', {
      domainName: apiDomain,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup:  albSg,
      vpcSubnets:     { subnetType: ec2.SubnetType.PUBLIC },
    });

    const httpsListener = alb.addListener('Https', {
      port:         443,
      protocol:     elbv2.ApplicationProtocol.HTTPS,
      certificates: [cert],
    });

    httpsListener.addTargets('Server', {
      port:     3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets:  [service],
      healthCheck: {
        path:                    '/health',
        healthyHttpCodes:        '200',
        interval:                cdk.Duration.seconds(30),
        timeout:                 cdk.Duration.seconds(5),
        healthyThresholdCount:   2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(20),
    });

    alb.addListener('HttpRedirect', {
      port:     80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol:  'HTTPS',
        port:      '443',
        permanent: true,
      }),
    });

    new route53.ARecord(this, 'ApiAlias', {
      zone,
      recordName: apiDomain,
      target:     route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: `https://${apiDomain}` });
    new cdk.CfnOutput(this, 'AlbDns', { value: alb.loadBalancerDnsName });
  }
}
