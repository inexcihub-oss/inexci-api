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
import { AccessControlService } from '../../shared/services/access-control.service';
import {
  nomeComExtensao,
  validarTipoArquivo,
} from '../../shared/storage/tipo-arquivo';

const MIME_PERMITIDOS: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
  'audio/webm',
  'video/mp4',
  'video/webm',
];

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
  [STORAGE_FOLDERS.PATIENT_PHOTOS]: ['image/jpeg', 'image/png', 'image/webp'],
};

function exigeDeteccao(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf';
}

@Injectable()
export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
    private readonly accessControlService: AccessControlService,
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

    const sizeLimit = STORAGE_FOLDER_SIZE_LIMITS[folder];
    if (sizeLimit !== undefined && file.buffer.length > sizeLimit) {
      throw new BadRequestException(
        `Arquivo excede o tamanho máximo permitido para esta pasta (${Math.round(sizeLimit / 1024)} KB)`,
      );
    }

    const { mime, ext } = await validarTipoArquivo(
      file,
      MIME_PERMITIDOS_POR_PASTA[folder] ?? MIME_PERMITIDOS,
      { exigeDeteccao },
    );

    let arquivo: Express.Multer.File = {
      ...file,
      mimetype: mime,
      originalname: nomeComExtensao(file.originalname, ext),
    };
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
    userId?: string | null,
  ): Promise<{ url: string }> {
    const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const [folder, tenantDoCaminho] = safePath.split('/');

    if (!PASTAS_PUBLICAS.includes(folder)) {
      if (!ownerId) {
        throw new ForbiddenException('Acesso negado ao arquivo solicitado');
      }

      if (TENANT_SCOPED_FOLDERS.includes(folder)) {
        const belongs = await this.podeAcessarDocumento(
          safePath,
          ownerId,
          userId,
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

  private async podeAcessarDocumento(
    uri: string,
    ownerId: string,
    userId: string | null | undefined,
  ): Promise<boolean> {
    const escopos = await this.documentRepository.findAccessScopesByUriAndOwner(
      uri,
      ownerId,
    );
    if (escopos.length === 0) return false;
    if (escopos.some((e) => !e.surgeryRequestId && !e.clinicalRecordId)) {
      return true;
    }
    if (!userId) return false;

    const acessiveis = new Set(
      await this.accessControlService.getAccessibleDoctorIds(userId),
    );
    return escopos.some((e) => {
      const medicos = [
        e.surgeryRequestId ? e.surgeryRequestDoctorId : undefined,
        e.clinicalRecordId ? e.clinicalRecordDoctorId : undefined,
      ].filter((m) => m !== undefined);
      return medicos.every((m) => !!m && acessiveis.has(m));
    });
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
