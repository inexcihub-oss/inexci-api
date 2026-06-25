import {
  Inject,
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { R2_CLIENT } from '../../config/r2.config';
import { STORAGE_FOLDER_TTL } from '../../config/storage.config';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(R2_CLIENT)
    private readonly s3: S3Client,
    private readonly configService: ConfigService,
  ) {
    const bucket = this.configService.get<string>('storage.bucket');
    if (!bucket) {
      throw new Error('Variável R2_BUCKET não configurada');
    }
    this.bucket = bucket;
  }

  private sanitizeFilename(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private getTtl(filePath: string): number {
    const folder = filePath.split('/')[0];
    return STORAGE_FOLDER_TTL[folder] ?? 3600;
  }

  async create(file: any, folder: string, tenantId?: string): Promise<string> {
    const sanitizedName = this.sanitizeFilename(file.originalname);
    const filename = `${uuid()}-${sanitizedName}`;
    const prefix = tenantId ? `${folder}/${tenantId}` : folder;
    const filePath = `${prefix}/${filename}`;

    this.logger.debug(
      `Upload: bucket=${this.bucket}, path=${filePath}, type=${file.mimetype}, size=${file.buffer?.length || 0}`,
    );

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      return filePath;
    } catch (error: any) {
      this.logger.error('Storage service error', error.stack);
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${error.message}`,
      );
    }
  }

  async getSignedUrl(filePath: string): Promise<string> {
    try {
      const ttl = this.getTtl(filePath);
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
      });
      return await getSignedUrl(this.s3, command, { expiresIn: ttl });
    } catch (error: any) {
      throw new BadRequestException(
        `Erro ao obter URL do arquivo: ${error.message}`,
      );
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    fileName: string,
    contentType: string,
    tenantId?: string,
  ): Promise<string> {
    const sanitizedName = this.sanitizeFilename(fileName);
    const finalName = `${uuid()}-${sanitizedName}`;
    const prefix = tenantId ? `${folder}/${tenantId}` : folder;
    const filePath = `${prefix}/${finalName}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      return filePath;
    } catch (error: any) {
      this.logger.error('Storage service error', error.stack);
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${error.message}`,
      );
    }
  }

  async move(fromPath: string, toFolder: string): Promise<string> {
    const fileName = fromPath.split('/').pop() || `${uuid()}.bin`;
    const toPath = `${toFolder}/${fileName}`;

    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${fromPath}`,
          Key: toPath,
        }),
      );
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: fromPath,
        }),
      );
      return toPath;
    } catch (error: any) {
      this.logger.error(`R2 move error: ${error.message}`);
      throw new BadRequestException(`Erro ao mover arquivo: ${error.message}`);
    }
  }

  async listFolder(
    folder: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Array<{ name: string; createdAt: string | null }>> {
    const limit = options.limit ?? 1000;

    try {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${folder}/`,
          MaxKeys: limit,
        }),
      );

      return (response.Contents || []).map((obj) => ({
        name: (obj.Key || '').replace(`${folder}/`, ''),
        createdAt: obj.LastModified?.toISOString() ?? null,
      }));
    } catch (err: any) {
      this.logger.warn(`R2 list error em ${folder}: ${err.message}`);
      return [];
    }
  }

  async download(filePath: string): Promise<Buffer | null> {
    if (!filePath) return null;
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        }),
      );

      if (!response.Body) {
        this.logger.warn(`R2 download: no body for ${filePath}`);
        return null;
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      this.logger.warn(
        `Falha inesperada ao baixar ${filePath}: ${err?.message || 'erro'}`,
      );
      return null;
    }
  }

  async deleteMany(paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: paths.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    } catch (err: any) {
      this.logger.warn(`R2 deleteMany error: ${err.message}`);
    }
  }

  async delete(filePath: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        }),
      );
    } catch (error: any) {
      throw new BadRequestException(
        `Erro ao deletar arquivo: ${error.message}`,
      );
    }
  }
}
