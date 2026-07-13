import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SurgeryRequestFromDocumentService } from './surgery-request-from-document.service';
import {
  DocumentExtractionJobData,
  SurgeryRequestDocumentExtractionJobsService,
} from './surgery-request-document-extraction-jobs.service';

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
    const jobId = String(job.id);
    const { userId, file } = job.data;

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

      await this.jobsService.markDone(jobId, userId, result, file.originalname);
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
    await this.jobsService.markError(
      jobId,
      userId,
      FRIENDLY_ERROR_MESSAGE,
      job.data?.file?.originalname,
    );
    this.logger.error(
      `[DOC_EXTRACT_JOB] dead-letter jobId=${jobId} userId=${userId} attempts=${job.attemptsMade} error=${error.message}`,
    );
  }
}
