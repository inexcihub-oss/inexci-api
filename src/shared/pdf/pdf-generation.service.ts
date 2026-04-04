import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

export interface PdfGenerationJobData {
  surgeryRequestId: string;
  userId: string;
}

@Injectable()
export class PdfGenerationService {
  private readonly logger = new Logger(PdfGenerationService.name);

  constructor(
    @InjectQueue('pdf-generation')
    private readonly pdfGenerationQueue: Queue,
  ) {}

  /**
   * Enfileira a geração assíncrona do PDF da solicitação cirúrgica.
   * Chamado após a transição PENDENTE → ENVIADA.
   * Não lança exceção — falhas apenas são registradas em log.
   */
  async scheduleGeneration(
    surgeryRequestId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.pdfGenerationQueue.add(
        'generate-pdf',
        { surgeryRequestId, userId } satisfies PdfGenerationJobData,
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
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enfileirar geração de PDF (Redis offline?): requestId="${surgeryRequestId}" — ${err?.message}`,
      );
    }
  }
}
