import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as path from 'path';
import {
  STORAGE_FOLDERS,
  STORAGE_FOLDER_SIZE_LIMITS,
} from '../../config/storage.config';
import { StorageService } from '../../shared/storage/storage.service';
import { DocumentRepository } from '../../database/repositories/document.repository';

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
  constructor(
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
  ) {}

  /**
   * Faz upload de um arquivo para o R2 Storage.
   * Valida MIME type, magic bytes e limite de tamanho por pasta.
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = STORAGE_FOLDERS.DOCUMENTS,
    ownerId?: string,
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

    const sizeLimit = STORAGE_FOLDER_SIZE_LIMITS[folder];
    if (sizeLimit !== undefined && file.buffer.length > sizeLimit) {
      throw new BadRequestException(
        `Arquivo excede o tamanho máximo permitido para esta pasta (${Math.round(sizeLimit / 1024)} KB)`,
      );
    }

    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(file.buffer);
    if (detected && detected.mime !== file.mimetype) {
      throw new BadRequestException('Tipo de arquivo inválido');
    }

    const filePath = await this.storageService.create(file, folder, ownerId);
    const url = await this.storageService.getSignedUrl(filePath);

    return { url, path: filePath };
  }

  /**
   * Gera uma URL assinada para um arquivo existente no Storage.
   * Para pastas com dados de pacientes exige que o arquivo pertença ao tenant.
   */
  async getSignedUrl(
    filePath: string,
    ownerId: string | null,
    _expiresIn = 3600,
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

    const url = await this.storageService.getSignedUrl(safePath);
    return { url };
  }

  /**
   * Deleta um arquivo do Storage.
   */
  async deleteFile(filePath: string): Promise<void> {
    await this.storageService.delete(filePath);
  }

  /**
   * Faz upload de múltiplos arquivos.
   */
  uploadMultipleFiles(
    files: Express.Multer.File[],
    folder: string = STORAGE_FOLDERS.DOCUMENTS,
    ownerId?: string,
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
      const result = await this.uploadFile(file, folder, ownerId);
      return {
        ...result,
        originalName: file.originalname,
      };
    });

    return Promise.all(uploadPromises);
  }
}
