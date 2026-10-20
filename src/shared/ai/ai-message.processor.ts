import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { context, propagation } from '@opentelemetry/api';
import { AiOrchestratorService } from './services/ai-orchestrator.service';
import { requestContextStorage } from 'src/shared/logging/request-context';

interface InboundMessageJob {
  from: string;
  body: string;
  messageSid: string;
  mediaUrl: string | null;
  _otelCarrier?: Record<string, string>;
  media?: Array<{
    url: string;
    contentType: string | null;
    category: 'audio' | 'other';
    durationSeconds: number | null;
  }>;
}

@Injectable()
@Processor('ai-messages')
export class AiMessageProcessor {
  private readonly logger = new Logger(AiMessageProcessor.name);

  constructor(private readonly orchestrator: AiOrchestratorService) {}

  @Process('process-message')
  async handle(job: Job<InboundMessageJob>): Promise<void> {
    const parentCtx = propagation.extract(
      context.active(),
      job.data._otelCarrier ?? {},
    );
    const { _otelCarrier, ...messageData } = job.data;
    void _otelCarrier;
    return context.with(parentCtx, () =>
      requestContextStorage.run({ requestId: job.data.messageSid }, () =>
        this.orchestrator.processMessage(messageData),
      ),
    );
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(
      `Job ${job.id} falhou após ${job.attemptsMade} tentativa(s): ${error.message}`,
    );
  }
}
