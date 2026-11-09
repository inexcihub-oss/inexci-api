import { Injectable, Logger } from '@nestjs/common';
import {
  AiUsageSource,
  AiTokenUsageLog,
} from '../../../database/entities/ai-token-usage-log.entity';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';
import { errorMessage } from '../../utils/error-message.util';
import { estimateCostCents } from './ai-usage-cost.util';

export interface AiUsageRecordInput {
  source: AiUsageSource;
  ownerId: string | null;
  userId: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  stage: string;
}

@Injectable()
export class AiUsageRecorder {
  private readonly logger = new Logger(AiUsageRecorder.name);

  constructor(private readonly repo: AiTokenUsageLogRepository) {}

  async record(input: AiUsageRecordInput): Promise<void> {
    try {
      const totalTokens = input.promptTokens + input.completionTokens;
      const row: Partial<AiTokenUsageLog> = {
        source: input.source,
        messageSid: null,
        phoneHash: null,
        conversationId: null,
        userId: input.userId,
        ownerId: input.ownerId,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens,
        callsCount: 1,
        model: input.model,
        latencyMs: input.latencyMs,
        costEstimateCents: estimateCostCents([input]),
        breakdown: [
          {
            stage: input.stage,
            promptTokens: input.promptTokens,
            completionTokens: input.completionTokens,
            totalTokens,
            model: input.model ?? undefined,
            latencyMs: input.latencyMs,
          },
        ],
      };
      await this.repo.create(row);
    } catch (error) {
      this.logger.warn(
        `Falha ao registrar uso de IA source=${input.source} stage=${input.stage}: ${errorMessage(error) || 'erro desconhecido'}`,
      );
    }
  }
}
