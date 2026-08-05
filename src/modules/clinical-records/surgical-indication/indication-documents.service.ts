import { Injectable, Logger } from '@nestjs/common';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import DOCUMENT_TYPES from 'src/common/document-types.common';

/**
 * Documentos emitidos no atendimento que não servem à autorização — receita e
 * atestado tratam do pós-consulta, não do procedimento. O pedido de exames
 * continua indo, porque é o que embasa a indicação.
 */
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
  /** Quanto ficou por copiar. Acima de zero, vale uma nova tentativa. */
  failed: number;
}

/**
 * Leva o acervo de documentos do paciente para a SC nascida de uma indicação
 * cirúrgica — quem for tocar a solicitação já encontra os exames anexados.
 *
 * Cada documento vira um **arquivo novo** no storage, não uma segunda linha
 * apontando para o mesmo objeto: excluir um documento da SC apaga o arquivo,
 * e caminhos compartilhados fariam essa exclusão apagar o documento do
 * prontuário junto.
 *
 * Tudo aqui é best-effort. A SC já está criada e commitada quando este serviço
 * roda; falhar em copiar um anexo não pode derrubar a criação da solicitação
 * nem o atendimento que a originou.
 */
@Injectable()
export class IndicationDocumentsService {
  private readonly logger = new Logger(IndicationDocumentsService.name);

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Nunca lança: quem chama decide o que fazer com o que sobrou (a fila tenta
   * de novo; a chamada inline apenas registra).
   */
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
      // Não dá para saber quanto faltou: sinaliza trabalho pendente.
      return { copied: 0, failed: 1 };
    }

    // Uma tentativa anterior pode ter copiado parte dos anexos antes de falhar.
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

        // Sem `patientId`/`clinicalRecordId`: a cópia pertence à solicitação.
        // Repeti-los faria o mesmo anexo aparecer duas vezes no prontuário.
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
