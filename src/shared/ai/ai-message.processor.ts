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
  /** Carrier W3C do OTel para propagação de trace context via Bull (tarefa 8.6). */
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
    // Restaura o trace context propagado pelo webhook via `_otelCarrier`.
    const parentCtx = propagation.extract(
      context.active(),
      job.data._otelCarrier ?? {},
    );
    const { _otelCarrier, ...messageData } = job.data;
    void _otelCarrier; // já consumido por propagation.extract acima
    // requestId de correlação de log = messageSid (userId é injetado depois
    // no contexto pelo orchestrator, assim que o usuário é identificado —
    // ver AiOrchestratorService.processMessage).
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
