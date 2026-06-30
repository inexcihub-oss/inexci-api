import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

export const R2_CLIENT = 'R2_CLIENT';

export function createR2Client(config: ConfigService): S3Client {
  const accountId = config.get<string>('R2_ACCOUNT_ID', '');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.get<string>('R2_ACCESS_KEY_ID', ''),
      secretAccessKey: config.get<string>('R2_SECRET_ACCESS_KEY', ''),
    },
  });
}
