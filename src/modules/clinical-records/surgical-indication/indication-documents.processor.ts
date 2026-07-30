import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { randomUUID } from 'crypto';
import { requestContextStorage } from 'src/shared/logging/request-context';
import { IndicationDocumentsService } from './indication-documents.service';
import {
  COPY_PATIENT_DOCUMENTS_JOB,
  CopyPatientDocumentsJobData,
  INDICATION_DOCUMENTS_QUEUE,
} from './indication-documents-jobs.service';

@Injectable()
@Processor(INDICATION_DOCUMENTS_QUEUE)
export class IndicationDocumentsProcessor {
  private readonly logger = new Logger(IndicationDocumentsProcessor.name);

  constructor(private readonly documentsService: IndicationDocumentsService) {}

  @Process(COPY_PATIENT_DOCUMENTS_JOB)
  async handleCopy(job: Job<CopyPatientDocumentsJobData>): Promise<void> {
    const requestId = job.data.requestId || randomUUID();
    return requestContextStorage.run({ requestId, userId: null }, () =>
      this.processCopy(job),
    );
  }

  private async processCopy(
    job: Job<CopyPatientDocumentsJobData>,
  ): Promise<void> {
    const { patientId, surgeryRequestId, ownerId, createdById } = job.data;

    const { copied, failed } = await this.documentsService.copyPatientDocuments(
      {
        patientId,
        surgeryRequestId,
        ownerId,
        createdById,
      },
    );

    // O serviço não lança: quem transforma pendência em retentativa é o job.
    // O que já foi copiado é reconhecido na próxima passada e não duplica.
    if (failed > 0) {
      throw new Error(
        `[SC_DOCS] SC ${surgeryRequestId}: faltaram ${failed} de ${copied + failed} documentos (tentativa ${job.attemptsMade + 1}).`,
      );
    }

    this.logger.log(
      `[SC_DOCS] SC ${surgeryRequestId}: ${copied} documentos anexados a partir do prontuário.`,
    );
  }
}
