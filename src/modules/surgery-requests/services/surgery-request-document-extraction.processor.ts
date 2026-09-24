import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SurgeryRequestFromDocumentService } from './surgery-request-from-document.service';
import {
  DocumentExtractionJobData,
  SurgeryRequestDocumentExtractionJobsService,
} from './surgery-request-document-extraction-jobs.service';
import { requestContextStorage } from 'src/shared/logging/request-context';
import { randomUUID } from 'crypto';

const DOCUMENT_EXTRACTION_QUEUE = 'document-extraction';
const DOCUMENT_EXTRACTION_JOB = 'extract-from-document';
const FRIENDLY_ERROR_MESSAGE =
  'Não foi possível processar o documento. Tente novamente.';

@Injectable()
@Processor(DOCUMENT_EXTRACTION_QUEUE)
export class SurgeryRequestDocumentExtractionProcessor {
  private readonly logger = new Logger(
    SurgeryRequestDocumentExtractionProcessor.name,
  );

  constructor(
    private readonly fromDocumentService: SurgeryRequestFromDocumentService,
    private readonly jobsService: SurgeryRequestDocumentExtractionJobsService,
  ) {}

  @Process(DOCUMENT_EXTRACTION_JOB)
  async handleExtractFromDocument(job: Job<DocumentExtractionJobData>) {
    const requestId = job.data.requestId || randomUUID();
    return requestContextStorage.run(
      { requestId, userId: job.data.userId ?? null },
      () => this.processExtractFromDocument(job),
    );
  }

  private async processExtractFromDocument(
    job: Job<DocumentExtractionJobData>,
  ) {
    const jobId = String(job.id);
    const { userId, file, notifyOnCompletion, surgeryRequestId } = job.data;

    await this.jobsService.markProcessing(jobId, userId);

    try {
      const result = await this.fromDocumentService.extractFromDocument(
        {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          buffer: Buffer.from(file.bufferBase64, 'base64'),
        } as Express.Multer.File,
        userId,
      );

      // `notifyOnCompletion` explicitamente `undefined` cai no default do
      // service (`= true`) — jobs enfileirados antes da flag existir também
      // não a possuem e continuam se comportando como antes.
      await this.jobsService.markDone(
        jobId,
        userId,
        result,
        file.originalname,
        notifyOnCompletion,
        surgeryRequestId,
      );
    } catch (err: any) {
      this.logger.warn(
        `[DOC_EXTRACT_JOB] falha jobId=${jobId} attempt=${job.attemptsMade + 1} userId=${userId} err=${err?.message}`,
      );
      throw err;
    }
  }

  @OnQueueFailed()
  async handleFailed(job: Job<DocumentExtractionJobData>, error: Error) {
    const maxAttempts = job.opts?.attempts ?? 3;
    if (job.attemptsMade < maxAttempts) return;

    const jobId = String(job.id);
    const userId = job.data.userId;
    const documentName = job.data?.file?.originalname;
    const { notifyOnCompletion, surgeryRequestId } = job.data;
    await this.jobsService.markError(
      jobId,
      userId,
      FRIENDLY_ERROR_MESSAGE,
      documentName,
      notifyOnCompletion,
      surgeryRequestId,
    );
    this.logger.error(
      `[DOC_EXTRACT_JOB] dead-letter jobId=${jobId} userId=${userId} attempts=${job.attemptsMade} error=${error.message}`,
    );
  }
}
