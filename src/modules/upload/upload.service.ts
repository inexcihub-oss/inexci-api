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
import {
  FOTO_PACIENTE_CONTENT_TYPE,
  nomeWebp,
  otimizarFotoPaciente,
} from '../../shared/storage/foto-paciente';
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

const TENANT_SCOPED_FOLDERS = [
  STORAGE_FOLDERS.DOCUMENTS,
  STORAGE_FOLDERS.POST_SURGICAL,
  STORAGE_FOLDERS.REPORT,
] as string[];

const PASTAS_PUBLICAS = [
  STORAGE_FOLDERS.AVATARS,
  STORAGE_FOLDERS.HEADERS,
] as string[];

const ALLOWED_FOLDERS: readonly string[] = Object.values(STORAGE_FOLDERS);

const MIME_PERMITIDOS_POR_PASTA: Record<string, readonly string[]> = {
  [STORAGE_FOLDERS.PATIENT_PHOTOS]: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ],
};

function mimeCanonico(mime: string): string {
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function exigeDeteccao(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf';
}

@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
  ) {}

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
    const permitidosNaPasta = MIME_PERMITIDOS_POR_PASTA[folder];
    if (
      !ext ||
      (permitidosNaPasta && !permitidosNaPasta.includes(file.mimetype))
    ) {
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
    const declarado = mimeCanonico(file.mimetype);
    if (
      (detected && mimeCanonico(detected.mime) !== declarado) ||
      (!detected && exigeDeteccao(declarado)) ||
      (detected &&
        permitidosNaPasta &&
        !permitidosNaPasta.includes(detected.mime))
    ) {
      throw new BadRequestException('Tipo de arquivo inválido');
    }

    let arquivo = file;
    if (folder === STORAGE_FOLDERS.PATIENT_PHOTOS) {
      let otimizada: Buffer;
      try {
        otimizada = await otimizarFotoPaciente(file.buffer);
      } catch {
        throw new BadRequestException(
          'Não foi possível ler a imagem enviada. Envie uma foto JPG, PNG ou WebP de até 40 megapixels.',
        );
      }
      arquivo = {
        ...file,
        buffer: otimizada,
        size: otimizada.length,
        mimetype: FOTO_PACIENTE_CONTENT_TYPE,
        originalname: nomeWebp(file.originalname),
      };
    }

    const filePath = await this.storageService.create(arquivo, folder, ownerId);
    const url = await this.storageService.getSignedUrl(filePath);

    return { url, path: filePath };
  }

  async getSignedUrl(
    filePath: string,
    ownerId: string | null,
    _expiresIn = 3600,
  ): Promise<{ url: string }> {
    const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const [folder, tenantDoCaminho] = safePath.split('/');

    if (!PASTAS_PUBLICAS.includes(folder)) {
      if (!ownerId) {
        throw new ForbiddenException('Acesso negado ao arquivo solicitado');
      }

      if (TENANT_SCOPED_FOLDERS.includes(folder)) {
        const belongs = await this.documentRepository.existsByUriAndOwner(
          safePath,
          ownerId,
        );
        if (!belongs) {
          throw new ForbiddenException('Acesso negado ao arquivo solicitado');
        }
      } else if (tenantDoCaminho !== ownerId) {
        throw new ForbiddenException('Acesso negado ao arquivo solicitado');
      }
    }

    const url = await this.storageService.getSignedUrl(safePath);
    return { url };
  }

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
