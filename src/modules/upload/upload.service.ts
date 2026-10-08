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

/** Pastas que armazenam dados de pacientes e requerem verificação de tenant. */
const TENANT_SCOPED_FOLDERS = [
  STORAGE_FOLDERS.DOCUMENTS,
  STORAGE_FOLDERS.POST_SURGICAL,
  STORAGE_FOLDERS.REPORT,
] as string[];

/**
 * Unicas pastas dispensadas de prova de posse: conteudo publico dentro da
 * plataforma (avatar e cabecalho aparecem para toda a equipe). Todo o resto
 * exige validacao — antes a lista era o inverso, e pastas criadas depois
 * (pdfs, signatures, whatsapp-tmp) nasceram sem checagem alguma.
 */
const PASTAS_PUBLICAS = [
  STORAGE_FOLDERS.AVATARS,
  STORAGE_FOLDERS.HEADERS,
] as string[];

const ALLOWED_FOLDERS: readonly string[] = Object.values(STORAGE_FOLDERS);

/**
 * Pastas que só aceitam um subconjunto dos tipos de `MIME_TO_EXT`. Foto de
 * paciente vira `<img>` na tela: PDF, áudio ou vídeo ali não têm uso e só
 * abririam porta para guardar outro tipo de arquivo atrás de uma "foto".
 */
const MIME_PERMITIDOS_POR_PASTA: Record<string, readonly string[]> = {
  [STORAGE_FOLDERS.PATIENT_PHOTOS]: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ],
};

/** `image/jpg` não é MIME oficial, mas navegadores mandam; o `file-type` diz `image/jpeg`. */
function mimeCanonico(mime: string): string {
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

/**
 * Tipos declarados cuja assinatura (magic bytes) o `file-type` sempre
 * reconhece: para eles, NÃO detectar nada já é prova de que o conteúdo não é
 * o declarado. É o caso clássico do SVG (texto/XML, que o `file-type` não
 * detecta) enviado como `image/png` — antes passava, porque só se recusava
 * quando a detecção dava OUTRO tipo. Áudio/vídeo ficam de fora: o `file-type`
 * devolve variantes (`audio/ogg; codecs=opus`, `video/mp4` para `.m4a`...)
 * e endurecer ali quebraria upload legítimo sem ganho real.
 */
function exigeDeteccao(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf';
}

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
      // Allowlist da pasta vale também para o tipo DETECTADO, não só o declarado.
      (detected &&
        permitidosNaPasta &&
        !permitidosNaPasta.includes(detected.mime))
    ) {
      throw new BadRequestException('Tipo de arquivo inválido');
    }

    // Foto de paciente vira WebP de até 800 px: a mesma versão serve a
    // miniatura e a foto ampliada, e um PNG de ~500 KB cai para ~15 KB.
    // O `otimizarFotoPaciente` ainda confere o formato pelo decoder do sharp
    // (jpeg/png/webp), limita os pixels da entrada e recusa imagem truncada —
    // qualquer erro dele é culpa do arquivo enviado, então vira 400.
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
    const [folder, tenantDoCaminho] = safePath.split('/');

    if (!PASTAS_PUBLICAS.includes(folder)) {
      if (!ownerId) {
        throw new ForbiddenException('Acesso negado ao arquivo solicitado');
      }

      // Pastas com registro em `documents`: prova de posse pela entidade.
      if (TENANT_SCOPED_FOLDERS.includes(folder)) {
        const belongs = await this.documentRepository.existsByUriAndOwner(
          safePath,
          ownerId,
        );
        if (!belongs) {
          throw new ForbiddenException('Acesso negado ao arquivo solicitado');
        }
      } else if (tenantDoCaminho !== ownerId) {
        // Demais pastas (pdfs, signatures, stamps, whatsapp-*): o proprio
        // caminho embute o ownerId — `${folder}/${ownerId}/${arquivo}`.
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
