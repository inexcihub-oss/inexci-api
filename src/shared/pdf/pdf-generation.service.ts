import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { getRequestContext } from 'src/shared/logging/request-context';
import { errorMessage } from 'src/shared/utils/error-message.util';

export interface PdfGenerationJobData {
  surgeryRequestId: string;
  userId: string;
  requestId?: string;
}

@Injectable()
export class PdfGenerationService {
  private readonly logger = new Logger(PdfGenerationService.name);

  constructor(
    @InjectQueue('pdf-generation')
    private readonly pdfGenerationQueue: Queue,
  ) {}

  async scheduleGeneration(
    surgeryRequestId: string,
    userId: string,
  ): Promise<void> {
    try {
      const requestId = getRequestContext()?.requestId;
      await this.pdfGenerationQueue.add(
        'generate-pdf',
        {
          surgeryRequestId,
          userId,
          requestId,
        } satisfies PdfGenerationJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(
        `Geração de PDF enfileirada para solicitação: ${surgeryRequestId}`,
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao enfileirar geração de PDF (Redis offline?): requestId="${surgeryRequestId}" — ${errorMessage(err)}`,
      );
    }
  }
}
