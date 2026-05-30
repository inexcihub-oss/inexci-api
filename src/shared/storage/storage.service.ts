import {
  Inject,
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { SUPABASE_ADMIN_CLIENT } from '../../config/supabase.config';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly supabase: SupabaseClient,
    private readonly configService: ConfigService,
  ) {
    const bucket = this.configService.get<string>('storage.bucket');
    if (!bucket) {
      throw new Error('Variável SUPABASE_BUCKET não configurada');
    }
    this.bucket = bucket;
  }
  /**
   * Sanitiza o nome do arquivo removendo acentos e caracteres inválidos
   * para garantir compatibilidade com as chaves do Supabase Storage.
   */
  private sanitizeFilename(name: string): string {
    return name
      .normalize('NFD') // decompõe caracteres acentuados (ex: "à" → "a" + combining accent)
      .replace(/[\u0300-\u036f]/g, '') // remove marcas diacríticas combinadas
      .replace(/[^a-zA-Z0-9._-]/g, '_') // substitui caracteres inválidos por "_"
      .replace(/_+/g, '_') // colapsa underscores consecutivos
      .replace(/^_|_$/g, ''); // remove underscores no início/fim
  }

  /**
   * Faz upload de um arquivo para o Supabase Storage
   * @param file - Arquivo do multer
   * @param folder - Pasta dentro do bucket
   * @returns Caminho do arquivo no bucket
   */
  async create(file: any, folder: string): Promise<string> {
    const sanitizedName = this.sanitizeFilename(file.originalname);
    const filename = `${uuid()}-${sanitizedName}`;
    const filePath = `${folder}/${filename}`;

    this.logger.debug(
      `Upload: bucket=${this.bucket}, path=${filePath}, type=${file.mimetype}, size=${file.buffer?.length || 0}`,
    );

    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        this.logger.error(`Supabase upload error: ${JSON.stringify(error)}`);
        throw new BadRequestException(`Erro ao fazer upload: ${error.message}`);
      }

      return data.path;
    } catch (error: any) {
      this.logger.error('Storage service error', error.stack);
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Gera URL assinada (válida por 1 hora) para acesso a arquivo privado
   * @param filePath - Caminho do arquivo no bucket
   * @returns URL assinada temporária
   */
  async getSignedUrl(filePath: string): Promise<string> {
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        // `download: false` explicita comportamento inline (abrir no navegador)
        // em vez de forçar download do arquivo.
        .createSignedUrl(filePath, 3600, { download: false }); // expira em 1 hora

      if (error || !data?.signedUrl) {
        throw new BadRequestException(
          `Erro ao gerar URL assinada: ${error?.message ?? 'URL inválida'}`,
        );
      }

      return data.signedUrl;
    } catch (error: any) {
      throw new BadRequestException(
        `Erro ao obter URL do arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Faz upload direto de um buffer (sem Multer) — útil para mídias geradas
   * fora de uma request HTTP, como documentos inbound vindos do WhatsApp.
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    fileName: string,
    contentType: string,
  ): Promise<string> {
    const sanitizedName = this.sanitizeFilename(fileName);
    const finalName = `${uuid()}-${sanitizedName}`;
    const filePath = `${folder}/${finalName}`;

    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .upload(filePath, buffer, {
          contentType,
          upsert: false,
        });

      if (error) {
        this.logger.error(`Supabase upload error: ${JSON.stringify(error)}`);
        throw new BadRequestException(`Erro ao fazer upload: ${error.message}`);
      }

      return data.path;
    } catch (error: any) {
      this.logger.error('Storage service error', error.stack);
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Move um arquivo já existente no bucket de uma pasta para outra,
   * preservando o nome do arquivo.
   */
  async move(fromPath: string, toFolder: string): Promise<string> {
    const fileName = fromPath.split('/').pop() || `${uuid()}.bin`;
    const toPath = `${toFolder}/${fileName}`;

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .move(fromPath, toPath);

    if (error) {
      this.logger.error(`Supabase move error: ${JSON.stringify(error)}`);
      throw new BadRequestException(`Erro ao mover arquivo: ${error.message}`);
    }

    return toPath;
  }

  /**
   * Lista arquivos de uma pasta. Retorna nomes relativos ao folder.
   */
  async listFolder(
    folder: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Array<{ name: string; createdAt: string | null }>> {
    const limit = options.limit ?? 1000;
    const offset = options.offset ?? 0;

    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .list(folder, {
        limit,
        offset,
        sortBy: { column: 'created_at', order: 'asc' },
      });

    if (error) {
      this.logger.warn(`Supabase list error em ${folder}: ${error.message}`);
      return [];
    }

    return (data || []).map((entry: any) => ({
      name: entry.name as string,
      createdAt: (entry.created_at as string | undefined) ?? null,
    }));
  }

  /**
   * Faz download de um arquivo do bucket e devolve como Buffer.
   * Usado para reprocessar documentos staged (OCR no Sprint 3 do plano OCR).
   * Não levanta exceção quando o arquivo não existe — devolve `null` para
   * que o chamador trate como "pendência expirada/limpa".
   */
  async download(filePath: string): Promise<Buffer | null> {
    if (!filePath) return null;
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .download(filePath);

      if (error || !data) {
        this.logger.warn(
          `Supabase download error em ${filePath}: ${error?.message || 'no data'}`,
        );
        return null;
      }

      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err: any) {
      this.logger.warn(
        `Falha inesperada ao baixar ${filePath}: ${err?.message || 'erro'}`,
      );
      return null;
    }
  }

  /**
   * Apaga múltiplos caminhos (nomes completos com folder) em batch.
   */
  async deleteMany(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove(paths);
    if (error) {
      this.logger.warn(`Supabase deleteMany error: ${error.message}`);
    }
  }

  /**
   * Deleta um arquivo do Supabase Storage
   * @param filePath - Caminho do arquivo no bucket
   */
  async delete(filePath: string): Promise<void> {
    try {
      const { error } = await this.supabase.storage
        .from(this.bucket)
        .remove([filePath]);

      if (error) {
        throw new BadRequestException(
          `Erro ao deletar arquivo: ${error.message}`,
        );
      }
    } catch (error: any) {
      throw new BadRequestException(
        `Erro ao deletar arquivo: ${error.message}`,
      );
    }
  }
}
