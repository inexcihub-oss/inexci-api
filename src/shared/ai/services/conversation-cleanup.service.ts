import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';

const DEFAULT_CLEANUP_DAYS = 15;

@Injectable()
export class ConversationCleanupService {
  private readonly logger = new Logger(ConversationCleanupService.name);

  constructor(
    private readonly conversationRepo: WhatsappConversationRepository,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldConversations(): Promise<void> {
    const days = this.configService.get<number>(
      'CONVERSATION_CLEANUP_DAYS',
      DEFAULT_CLEANUP_DAYS,
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const deleted = await this.conversationRepo.deleteOlderThan(cutoff);

    // T31: Registrar último cleanup no DB para idempotência
    await this.recordCleanupRun(deleted, cutoff);

    this.logger.log(
      `Limpeza de conversas: ${deleted} registros removidos (anteriores a ${cutoff.toISOString().slice(0, 10)})`,
    );
  }

  // T31: Registra execução do cleanup para auditoria/idempotência
  private async recordCleanupRun(
    deletedCount: number,
    cutoffDate: Date,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO conversation_cleanup_log (deleted_count, cutoff_date, executed_at)
         VALUES ($1, $2, NOW())`,
        [deletedCount, cutoffDate],
      );
    } catch {
      // Tabela pode não existir ainda — silencia o erro
    }
  }
}
