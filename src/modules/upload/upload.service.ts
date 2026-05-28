import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';
import { SUPABASE_ADMIN_CLIENT } from '../../config/supabase.config';
import { STORAGE_FOLDERS } from '../../config/storage.config';
import { DocumentRepository } from '../../database/repositories/document.repository';
import { v4 as uuidv4 } from 'uuid';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'mp4',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Pastas que armazenam dados de pacientes e requerem verificação de tenant. */
const TENANT_SCOPED_FOLDERS = [
  STORAGE_FOLDERS.DOCUMENTS,
  STORAGE_FOLDERS.POST_SURGICAL,
  STORAGE_FOLDERS.REPORT,
] as string[];

const ALLOWED_FOLDERS: readonly string[] = Object.values(STORAGE_FOLDERS);

@Injectable()
export class UploadService {
  private readonly bucket: string;

  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly supabase: SupabaseClient,
    private readonly configService: ConfigService,
    private readonly documentRepository: DocumentRepository,
  ) {
    this.bucket = this.configService.get<string>(
      'storage.bucket',
      'inexci-storage',
    );
  }

  /**
   * Faz upload de um arquivo para o Supabase Storage
   * @param file - Arquivo do multer
   * @param folder - Pasta dentro do bucket (ex: 'documents', 'avatars')
   * @returns URL pública do arquivo
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = STORAGE_FOLDERS.DOCUMENTS,
  ): Promise<{ url: string; path: string }> {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    if (!folder || !ALLOWED_FOLDERS.includes(folder)) {
      throw new BadRequestException(
        `Pasta inválida. Valores permitidos: ${ALLOWED_FOLDERS.join(', ')}`,
      );
    }

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Tipo de arquivo não permitido: ${file.mimetype}`,
      );
    }
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = `${folder}/${fileName}`;

    try {
      // Upload para o Supabase Storage
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        throw new BadRequestException(`Erro ao fazer upload: ${error.message}`);
      }

      // Gerar URL assinada (1h) para acesso ao bucket privado
      const { data: signedData, error: _signedError } =
        await this.supabase.storage
          .from(this.bucket)
          .createSignedUrl(data.path, 3600);

      const url = signedData?.signedUrl ?? data.path;

      return {
        url,
        path: data.path,
      };
    } catch (error) {
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Gera uma URL assinada para um arquivo existente no Storage.
   * Para pastas com dados de pacientes exige que o arquivo pertença ao tenant.
   * @param filePath - Caminho do arquivo no bucket
   * @param ownerId - ID do tenant do usuário autenticado
   * @param expiresIn - Validade em segundos (padrão 3600 = 1h)
   */
  async getSignedUrl(
    filePath: string,
    ownerId: string | null,
    expiresIn = 3600,
  ): Promise<{ url: string }> {
    const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const folder = safePath.split('/')[0];
    if (TENANT_SCOPED_FOLDERS.includes(folder)) {
      if (!ownerId) {
        throw new ForbiddenException('Acesso negado ao arquivo solicitado');
      }
      const belongs = await this.documentRepository.existsByUriAndOwner(
        safePath,
        ownerId,
      );
      if (!belongs) {
        throw new ForbiddenException('Acesso negado ao arquivo solicitado');
      }
    }

    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(safePath, expiresIn);

    if (error || !data?.signedUrl) {
      throw new BadRequestException(
        `Erro ao gerar URL assinada: ${error?.message ?? 'unknown'}`,
      );
    }

    return { url: data.signedUrl };
  }

  /**
   * Deleta um arquivo do Supabase Storage
   * @param filePath - Caminho do arquivo no bucket
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const { error } = await this.supabase.storage
        .from(this.bucket)
        .remove([filePath]);

      if (error) {
        throw new BadRequestException(
          `Erro ao deletar arquivo: ${error.message}`,
        );
      }
    } catch (error) {
      throw new BadRequestException(
        `Erro ao deletar arquivo: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Faz upload de múltiplos arquivos
   * @param files - Array de arquivos do multer
   * @param folder - Pasta dentro do bucket
   * @returns Array de URLs públicas
   */
  uploadMultipleFiles(
    files: Express.Multer.File[],
    folder: string = STORAGE_FOLDERS.DOCUMENTS,
  ): Promise<Array<{ url: string; path: string; originalName: string }>> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    if (!folder || !ALLOWED_FOLDERS.includes(folder)) {
      throw new BadRequestException(
        `Pasta inválida. Valores permitidos: ${ALLOWED_FOLDERS.join(', ')}`,
      );
    }

    const uploadPromises = files.map(async (file) => {
      const result = await this.uploadFile(file, folder);
      return {
        ...result,
        originalName: file.originalname,
      };
    });

    return Promise.all(uploadPromises);
  }
}
