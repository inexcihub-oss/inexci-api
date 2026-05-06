import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';

const CLEANUP_DAYS = 30;

@Injectable()
export class ConversationCleanupService {
  private readonly logger = new Logger(ConversationCleanupService.name);

  constructor(
    private readonly conversationRepo: WhatsappConversationRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldConversations(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CLEANUP_DAYS);

    const deleted = await this.conversationRepo.deleteOlderThan(cutoff);
    this.logger.log(
      `Limpeza de conversas: ${deleted} registros removidos (anteriores a ${cutoff.toISOString().slice(0, 10)})`,
    );
  }
}
