import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';

export interface ClientStackProps extends cdk.StackProps {
  rootDomain: string;
}

// CloudFront certs must live in us-east-1, but bucket + distribution live in
// the primary region. We create the cert in a sibling stack and wire it across
// via crossRegionReferences.
export class ClientStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClientStackProps) {
    super(scope, id, props);

    const { rootDomain } = props;

    const certStack = new cdk.Stack(scope, `${id}Cert`, {
      env: { account: props.env?.account, region: 'us-east-1' },
      crossRegionReferences: true,
    });

    const certZone = route53.HostedZone.fromLookup(certStack, 'Zone', { domainName: rootDomain });
    const cert = new acm.Certificate(certStack, 'Cert', {
      domainName:               rootDomain,
      subjectAlternativeNames:  [`www.${rootDomain}`],
      validation:               acm.CertificateValidation.fromDns(certZone),
    });

    this.addDependency(certStack);

    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: rootDomain });

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption:        s3.BucketEncryption.S3_MANAGED,
      enforceSSL:        true,
      removalPolicy:     cdk.RemovalPolicy.RETAIN,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin:               origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods:       cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy:          cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress:             true,
      },
      defaultRootObject: 'index.html',
      domainNames:       [rootDomain, `www.${rootDomain}`],
      certificate:       cert,
      priceClass:        cloudfront.PriceClass.PRICE_CLASS_ALL,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
      ],
    });

    new route53.ARecord(this, 'ApexAlias', {
      zone,
      recordName: rootDomain,
      target:     route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });

    new route53.ARecord(this, 'WwwAlias', {
      zone,
      recordName: `www.${rootDomain}`,
      target:     route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources:           [s3deploy.Source.asset(path.join(__dirname, '../../client/dist'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'BucketName',         { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId',     { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'SiteUrl',            { value: `https://${rootDomain}` });
  }
}
