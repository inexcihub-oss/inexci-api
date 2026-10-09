import { Injectable, Logger } from '@nestjs/common';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import DOCUMENT_TYPES from 'src/common/document-types.common';

const SKIPPED_KEYS: readonly string[] = [
  DOCUMENT_TYPES.prescription,
  DOCUMENT_TYPES.medicalCertificate,
];

export interface CopyPatientDocumentsParams {
  patientId: string;
  surgeryRequestId: string;
  ownerId: string;
  createdById: string;
}

export interface CopyPatientDocumentsResult {
  copied: number;
  failed: number;
}

@Injectable()
export class IndicationDocumentsService {
  private readonly logger = new Logger(IndicationDocumentsService.name);

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly storageService: StorageService,
  ) {}

  async copyPatientDocuments(
    params: CopyPatientDocumentsParams,
  ): Promise<CopyPatientDocumentsResult> {
    let documents: Awaited<ReturnType<DocumentRepository['findByPatientId']>> =
      [];
    let alreadyCopied: Array<{ key: string; name: string }> = [];

    try {
      [documents, alreadyCopied] = await Promise.all([
        this.documentRepository.findByPatientId(params.patientId),
        this.documentRepository.findBySurgeryRequestId(params.surgeryRequestId),
      ]);
    } catch (err: any) {
      this.logger.error(
        `[SC_DOCS] Falha ao listar documentos do paciente ${params.patientId}: ${err?.message}`,
      );
      return { copied: 0, failed: 1 };
    }

    const present = new Set(
      alreadyCopied.map((document) => `${document.key}::${document.name}`),
    );

    const copyable = documents.filter(
      (document): document is typeof document & { uri: string } =>
        Boolean(document.uri) &&
        !SKIPPED_KEYS.includes(document.key) &&
        !present.has(`${document.key}::${document.name}`),
    );
    if (copyable.length === 0) return { copied: 0, failed: 0 };

    let copied = 0;
    let failed = 0;
    for (const document of copyable) {
      try {
        const storagePath = await this.storageService.copy(
          document.uri,
          STORAGE_FOLDERS.DOCUMENTS,
          params.ownerId,
        );

        await this.documentRepository.create({
          surgeryRequestId: params.surgeryRequestId,
          createdById: params.createdById,
          type: document.type,
          key: document.key,
          name: document.name,
          uri: storagePath,
        });
        copied += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(
          `[SC_DOCS] Documento ${document.id} não foi copiado para a SC ${params.surgeryRequestId}: ${err?.message}`,
        );
      }
    }

    this.logger.log(
      `[SC_DOCS] ${copied}/${copyable.length} documentos copiados para a SC ${params.surgeryRequestId}`,
    );
    return { copied, failed };
  }
}
