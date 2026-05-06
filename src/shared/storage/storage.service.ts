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
    this.bucket = this.configService.get<string>(
      'storage.bucket',
      'inexci-storage',
    );
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
        .createSignedUrl(filePath, 3600); // expira em 1 hora

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
