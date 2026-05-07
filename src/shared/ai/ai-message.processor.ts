import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AiOrchestratorService } from './services/ai-orchestrator.service';

interface InboundMessageJob {
  from: string;
  body: string;
  messageSid: string;
  mediaUrl: string | null;
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
    await this.orchestrator.processMessage(job.data);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(
      `Job ${job.id} falhou após ${job.attemptsMade} tentativa(s): ${error.message}`,
    );
  }
}
