import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { recordQueueJobDuration } from './metrics.util';
import { reportPlatformError } from './platform-errors/platform-error-sink';

const QUEUES_WITH_OWN_FAILURE_LOG = new Set(['mail', 'whatsapp-messages']);

interface JobOwnership {
  tenantId?: unknown;
  userId?: unknown;
  requestId?: unknown;
}

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
    @InjectQueue('mention-emails')
    private readonly mentionEmailsQueue: Queue,
  ) {}

  onModuleInit(): void {
    [
      this.mailQueue,
      this.whatsappQueue,
      this.pdfGenerationQueue,
      this.aiMessagesQueue,
      this.documentExtractionQueue,
      this.indicationDocumentsQueue,
      this.mentionEmailsQueue,
    ].forEach((queue) => this.attachListeners(queue));
  }

  private attachListeners(queue: Queue): void {
    queue.on('completed', (job: Job) =>
      this.recordDuration(queue.name, job, 'completed'),
    );
    queue.on('failed', (job: Job, error: unknown) => {
      this.recordDuration(queue.name, job, 'failed');
      this.reportFinalFailure(queue.name, job, error);
    });
  }

  private reportFinalFailure(
    queueName: string,
    job: Job,
    error: unknown,
  ): void {
    if (QUEUES_WITH_OWN_FAILURE_LOG.has(queueName)) return;
    const attempts = job?.opts?.attempts ?? 1;
    if ((job?.attemptsMade ?? 0) < attempts) return;
    const data = (job?.data ?? {}) as JobOwnership;
    reportPlatformError({
      source: 'queue',
      route: queueName,
      error,
      ownerId: typeof data.tenantId === 'string' ? data.tenantId : null,
      userId: typeof data.userId === 'string' ? data.userId : null,
      requestId: typeof data.requestId === 'string' ? data.requestId : null,
    });
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
