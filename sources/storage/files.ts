import * as Minio from 'minio';
import { fromContainerMetadata, fromEnv } from '@aws-sdk/credential-providers';

const s3Host = process.env.S3_HOST!;
const s3Port = process.env.S3_PORT ? parseInt(process.env.S3_PORT, 10) : undefined;
const s3UseSSL = process.env.S3_USE_SSL ? process.env.S3_USE_SSL === 'true' : true;

// Use explicit credentials if provided, otherwise use IAM role (for AWS ECS/EC2)
const useIamAuth = !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY;

// AWS SDK credential provider for ECS task role
const awsCredentialProvider = fromContainerMetadata({
    timeout: 5000,
    maxRetries: 3,
});

// Minio expects a Credentials object with getter methods
class MinioCredentials {
    constructor(
        private accessKeyValue: string,
        private secretKeyValue: string,
        private sessionTokenValue?: string
    ) {}

    getAccessKey(): string {
        return this.accessKeyValue;
    }

    getSecretKey(): string {
        return this.secretKeyValue;
    }

    getSessionToken(): string | undefined {
        return this.sessionTokenValue;
    }
}

// Custom credential provider that wraps AWS SDK's provider for Minio
class AwsSdkCredentialProvider {
    async getCredentials(): Promise<MinioCredentials> {
        const credentials = await awsCredentialProvider();
        return new MinioCredentials(
            credentials.accessKeyId,
            credentials.secretAccessKey,
            credentials.sessionToken
        );
    }
}

async function createS3Client(): Promise<Minio.Client> {
    const region = process.env.AWS_REGION || 'us-east-1';
    if (useIamAuth) {
        // Use AWS SDK credential provider for ECS task role
        return new Minio.Client({
            endPoint: s3Host,
            port: s3Port,
            useSSL: s3UseSSL,
            region: region,
            credentialsProvider: new AwsSdkCredentialProvider() as any,
        });
    }
    return new Minio.Client({
        endPoint: s3Host,
        port: s3Port,
        useSSL: s3UseSSL,
        region: region,
        accessKey: process.env.S3_ACCESS_KEY!,
        secretKey: process.env.S3_SECRET_KEY!,
    });
}

// Initialize client lazily
let _s3client: Minio.Client | null = null;

export async function getS3Client(): Promise<Minio.Client> {
    if (!_s3client) {
        _s3client = await createS3Client();
    }
    return _s3client;
}

// For backwards compatibility - will throw if called before initialization
export const s3client = new Proxy({} as Minio.Client, {
    get(_, prop) {
        if (!_s3client) {
            throw new Error('S3 client not initialized. Call loadFiles() first or use getS3Client()');
        }
        return (_s3client as any)[prop];
    }
});

export const s3bucket = process.env.S3_BUCKET!;

export const s3host = process.env.S3_HOST!

export const s3public = process.env.S3_PUBLIC_URL!;

export async function loadFiles() {
    const client = await getS3Client();
    await client.bucketExists(s3bucket); // Throws if bucket does not exist or is not accessible
}

export function getPublicUrl(path: string) {
    return `${s3public}/${path}`;
}

export type ImageRef = {
    width: number;
    height: number;
    thumbhash: string;
    path: string;
}
