import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { getRequestContext } from 'src/shared/logging/request-context';
import {
  CopyPatientDocumentsParams,
  IndicationDocumentsService,
} from './indication-documents.service';

export const INDICATION_DOCUMENTS_QUEUE = 'indication-documents';
export const COPY_PATIENT_DOCUMENTS_JOB = 'copy-patient-documents';

export interface CopyPatientDocumentsJobData extends CopyPatientDocumentsParams {
  /** Correlation ID propagado para o processor (logging end-to-end). */
  requestId?: string;
}

/**
 * Produtor da cópia de documentos para a SC nascida de uma indicação.
 *
 * Enfileirar em vez de copiar inline mantém a resposta de "Finalizar
 * atendimento" fora do tempo de N cópias no R2 e, mais importante, dá
 * retentativa: a cópia direta perdia em silêncio os anexos de um paciente
 * quando o storage oscilava.
 */
@Injectable()
export class IndicationDocumentsJobsService {
  private readonly logger = new Logger(IndicationDocumentsJobsService.name);

  constructor(
    @InjectQueue(INDICATION_DOCUMENTS_QUEUE)
    private readonly queue: Queue,
    private readonly documentsService: IndicationDocumentsService,
  ) {}

  /** Nunca lança: a SC já existe e nada aqui pode derrubar o atendimento. */
  async schedule(params: CopyPatientDocumentsParams): Promise<void> {
    try {
      await this.queue.add(
        COPY_PATIENT_DOCUMENTS_JOB,
        {
          ...params,
          requestId: getRequestContext()?.requestId,
        } satisfies CopyPatientDocumentsJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      return;
    } catch (err: any) {
      this.logger.warn(
        `[SC_DOCS] Fila indisponível para a SC ${params.surgeryRequestId} (${err?.message}); copiando na hora.`,
      );
    }

    // Fallback com Redis fora: um atendimento mais lento é melhor do que uma
    // solicitação que nasce sem os exames do paciente.
    try {
      const { copied, failed } =
        await this.documentsService.copyPatientDocuments(params);
      if (failed > 0) {
        this.logger.warn(
          `[SC_DOCS] SC ${params.surgeryRequestId}: ${copied} copiados, ${failed} pendentes e sem fila para retentar.`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `[SC_DOCS] Cópia direta falhou para a SC ${params.surgeryRequestId}: ${err?.message}`,
      );
    }
  }
}
