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
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { R2_CLIENT } from '../../config/r2.config';
import {
  STORAGE_FOLDER_CACHE_CONTROL,
  STORAGE_FOLDER_TTL,
} from '../../config/storage.config';
import { errorMessage } from 'src/shared/utils/error-message.util';

export interface ArquivoParaUpload {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

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

  private cacheControl(filePath: string): string | undefined {
    return STORAGE_FOLDER_CACHE_CONTROL[filePath.split('/')[0]];
  }

  async create(
    file: ArquivoParaUpload,
    folder: string,
    tenantId?: string,
  ): Promise<string> {
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
          CacheControl: this.cacheControl(filePath),
        }),
      );
      return filePath;
    } catch (error) {
      this.logger.error(
        'Storage service error',
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${errorMessage(error)}`,
      );
    }
  }

  async getSignedUrl(filePath: string): Promise<string> {
    try {
      const ttl = this.getTtl(filePath);
      const cacheControl = this.cacheControl(filePath);
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
        ...(cacheControl ? { ResponseCacheControl: cacheControl } : {}),
      });
      if (!cacheControl) {
        return await getSignedUrl(this.s3, command, { expiresIn: ttl });
      }
      const janelaMs = (ttl * 1000) / 2;
      const inicioDaJanela = new Date(
        Math.floor(Date.now() / janelaMs) * janelaMs,
      );
      return await getSignedUrl(this.s3, command, {
        expiresIn: ttl,
        signingDate: inicioDaJanela,
      });
    } catch (error) {
      throw new BadRequestException(
        `Erro ao obter URL do arquivo: ${errorMessage(error)}`,
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
          CacheControl: this.cacheControl(filePath),
        }),
      );
      return filePath;
    } catch (error) {
      this.logger.error(
        'Storage service error',
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${errorMessage(error)}`,
      );
    }
  }

  async copy(
    fromPath: string,
    toFolder: string,
    tenantId?: string,
  ): Promise<string> {
    const fileName = fromPath.split('/').pop() || `${uuid()}.bin`;
    const prefix = tenantId ? `${toFolder}/${tenantId}` : toFolder;
    const toPath = `${prefix}/${uuid()}-${fileName}`;

    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${fromPath}`,
          Key: toPath,
        }),
      );
      return toPath;
    } catch (error) {
      this.logger.error(`R2 copy error: ${errorMessage(error)}`);
      throw new BadRequestException(
        `Erro ao copiar arquivo: ${errorMessage(error)}`,
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
    } catch (error) {
      this.logger.error(`R2 move error: ${errorMessage(error)}`);
      throw new BadRequestException(
        `Erro ao mover arquivo: ${errorMessage(error)}`,
      );
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
    } catch (err) {
      this.logger.warn(`R2 list error em ${folder}: ${errorMessage(err)}`);
      return [];
    }
  }

  async listAll(
    folder: string,
    maxPaginas = 100,
  ): Promise<Array<{ key: string; lastModified: Date | null }>> {
    const objetos: Array<{ key: string; lastModified: Date | null }> = [];
    let token: string | undefined;
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const resposta = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${folder}/`,
          ContinuationToken: token,
        }),
      );
      for (const obj of resposta?.Contents ?? []) {
        if (obj.Key) {
          objetos.push({
            key: obj.Key,
            lastModified: obj.LastModified ?? null,
          });
        }
      }
      if (!resposta?.IsTruncated || !resposta.NextContinuationToken) break;
      token = resposta.NextContinuationToken;
    }
    return objetos;
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
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      this.logger.warn(
        `Falha inesperada ao baixar ${filePath}: ${errorMessage(err) || 'erro'}`,
      );
      return null;
    }
  }

  async deleteMany(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    try {
      const resposta = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: paths.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      const falhas = (resposta?.Errors ?? [])
        .map((e) => e.Key)
        .filter((k): k is string => !!k);
      if (falhas.length) {
        this.logger.warn(
          `R2 deleteMany: ${falhas.length} de ${paths.length} objetos não foram apagados`,
        );
      }
      return falhas;
    } catch (err) {
      this.logger.warn(`R2 deleteMany error: ${errorMessage(err)}`);
      return [...paths];
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: filePath }),
      );
      return true;
    } catch (error) {
      const falha = (
        typeof error === 'object' && error !== null ? error : {}
      ) as { $metadata?: { httpStatusCode?: number }; name?: unknown };
      const status = falha.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        falha.name === 'NotFound' ||
        falha.name === 'NoSuchKey'
      ) {
        return false;
      }
      this.logger.warn(`R2 head error: ${errorMessage(error) || 'erro'}`);
      throw error;
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
    } catch (error) {
      throw new BadRequestException(
        `Erro ao deletar arquivo: ${errorMessage(error)}`,
      );
    }
  }
}
