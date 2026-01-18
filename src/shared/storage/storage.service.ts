import { Injectable } from '@nestjs/common';

import { v4 as uuid } from 'uuid';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private s3;

  constructor() {
    this.s3 = new S3Client({
      forcePathStyle: false,
      endpoint: process.env.ENDPOINT,
      region: 'nyc3',
      credentials: {
        accessKeyId: process.env.DIGITAL_OCEAN_KEYID,
        secretAccessKey: process.env.DIGITAL_OCEAN_ACCESSKEY,
      },
    });
  }

  async create(file: any, folder: string) {
    const filename = `${uuid()}-${file.originalname}`.trim();

    const command = new PutObjectCommand({
      Bucket: process.env.SPACE_NAME,
      Key: `${folder}/${filename}`,
      Body: file.buffer,
      ACL: 'private',
    });

    try {
      await this.s3.send(command);
    } catch (error: any) {
      // Error handled silently
    }

    return `${folder}/${filename}`;
  }

  async getSignedUrl(dir: string): Promise<string> {
    const mimetype = dir.split('.')[1];

    const command = new GetObjectCommand({
      Bucket: process.env.SPACE_NAME,
      Key: dir,
      ResponseContentDisposition: 'inline',
      ResponseContentType:
        mimetype?.toLowerCase() === 'pdf' ? 'application/pdf' : 'text/plain',
    });

    try {
      const signedUrl = await getSignedUrl(this.s3, command);
      return signedUrl;
    } catch (error) {
      // Error handled silently
    }
  }
}
