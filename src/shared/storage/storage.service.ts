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
import {
  STORAGE_FOLDER_CACHE_CONTROL,
  STORAGE_FOLDER_TTL,
} from '../../config/storage.config';

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
          CacheControl: this.cacheControl(filePath),
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
      const cacheControl = this.cacheControl(filePath);
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
        // Vale também para objetos enviados antes do `CacheControl` no upload.
        ...(cacheControl ? { ResponseCacheControl: cacheControl } : {}),
      });
      if (!cacheControl) {
        return await getSignedUrl(this.s3, command, { expiresIn: ttl });
      }
      // Link estável: assina com o início da janela atual (múltiplo de
      // TTL/2), então todas as leituras dentro dela devolvem a MESMA URL e o
      // navegador usa o cache. Validade = TTL: um link entregue no fim da
      // janela ainda vale pelo menos TTL/2, e nenhum vale mais que TTL a
      // partir da assinatura.
      //
      // Trade-off: quem pede no começo da janela recebe um link que vale
      // quase TTL inteiro; quem pede no fim, só TTL/2. E todos os usuários da
      // janela recebem a mesma URL (dado de paciente: a URL não deve ser
      // repassada, mas se for, morre em no máximo TTL). Antes a validade era
      // TTL×2 — uma foto de paciente aberta por até 2 h com um link só.
      // O `max-age` da pasta (STORAGE_FOLDER_CACHE_CONTROL) fica em TTL/2,
      // para a cópia no cache do navegador não sobreviver ao link.
      const janelaMs = (ttl * 1000) / 2;
      const inicioDaJanela = new Date(
        Math.floor(Date.now() / janelaMs) * janelaMs,
      );
      return await getSignedUrl(this.s3, command, {
        expiresIn: ttl,
        signingDate: inicioDaJanela,
      });
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
          CacheControl: this.cacheControl(filePath),
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

  /**
   * Duplica um arquivo dentro do bucket, gerando um objeto novo (o original
   * permanece). Usado quando dois registros precisam de ciclos de vida
   * independentes — excluir um documento apaga o objeto dele, então
   * compartilhar o mesmo caminho faria uma exclusão levar a outra junto.
   */
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
    } catch (error: any) {
      this.logger.error(`R2 copy error: ${error.message}`);
      throw new BadRequestException(`Erro ao copiar arquivo: ${error.message}`);
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

  /**
   * Lista TODOS os objetos sob `folder/` (recursivo), paginando pelo
   * `ContinuationToken` — o `listFolder` para nos primeiros 1000. Feito para
   * varreduras (limpeza de órfãos), então, ao contrário do `listFolder`,
   * **lança** se a listagem falhar: uma lista truncada em silêncio faria a
   * varredura achar que terminou. `maxPaginas` é só um teto de segurança.
   */
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

  /**
   * Apaga vários objetos numa chamada só (até 1000 por requisição, limite do
   * S3). Não lança: devolve as chaves que NÃO foram apagadas — as que o R2
   * recusou uma a uma (`Errors`) ou todas, se a requisição inteira falhou —
   * para quem precisa saber (ex.: conversão de fotos) reportar o que sobrou.
   */
  async deleteMany(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    try {
      const resposta = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: paths.map((Key) => ({ Key })),
            // Com `Quiet`, o S3 ainda devolve `Errors`; só omite os sucessos.
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
    } catch (err: any) {
      this.logger.warn(`R2 deleteMany error: ${err.message}`);
      return [...paths];
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
