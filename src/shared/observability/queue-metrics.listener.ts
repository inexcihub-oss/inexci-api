/**
 * Fase 4 do `PLANO-OBSERVABILIDADE-GRAFANA.md` (Dashboard 5 — Filas Bull).
 *
 * As filas Bull não emitem eventos via `@nestjs/event-emitter` — cada fila tem
 * seu próprio EventEmitter (`queue.on('completed'|'failed', ...)`). Este
 * listener assina os 5 filas registradas em `QueuesModule` e converte
 * `job.finishedOn - job.processedOn` em `inexci.queue.job.duration`, sem
 * tocar nos processors de negócio.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { recordQueueJobDuration } from './metrics.util';

@Injectable()
export class QueueMetricsListener implements OnModuleInit {
  constructor(
    @InjectQueue('mail') private readonly mailQueue: Queue,
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue,
    @InjectQueue('pdf-generation')
    private readonly pdfGenerationQueue: Queue,
    @InjectQueue('ai-messages') private readonly aiMessagesQueue: Queue,
    @InjectQueue('document-extraction')
    private readonly documentExtractionQueue: Queue,
    @InjectQueue('indication-documents')
    private readonly indicationDocumentsQueue: Queue,
  ) {}

  onModuleInit(): void {
    [
      this.mailQueue,
      this.whatsappQueue,
      this.pdfGenerationQueue,
      this.aiMessagesQueue,
      this.documentExtractionQueue,
      this.indicationDocumentsQueue,
    ].forEach((queue) => this.attachListeners(queue));
  }

  private attachListeners(queue: Queue): void {
    queue.on('completed', (job: Job) =>
      this.recordDuration(queue.name, job, 'completed'),
    );
    queue.on('failed', (job: Job) =>
      this.recordDuration(queue.name, job, 'failed'),
    );
  }

  private recordDuration(
    queueName: string,
    job: Job,
    status: 'completed' | 'failed',
  ): void {
    if (!job.processedOn || !job.finishedOn) {
      return;
    }

    const durationMs = job.finishedOn - job.processedOn;
    recordQueueJobDuration(durationMs, { queue: queueName, status });
  }
}
