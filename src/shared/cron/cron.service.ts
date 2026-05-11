import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly staleNotificationService: StaleNotificationService,
    private readonly weeklySummaryService: WeeklySummaryService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleStaleNotifications() {
    this.logger.log('Iniciando verificação de solicitações paradas (stale)...');
    try {
      const count =
        await this.staleNotificationService.checkAndNotifyStaleRequests();
      this.logger.log(`Stale check finalizado: ${count} notificações enviadas`);
    } catch (err: any) {
      this.logger.error(`Erro no cron de stale: ${err?.message}`);
    }
  }

  /**
   * Resumo semanal — todo domingo às 08:00 (BRT).
   * Cobre a semana ISO anterior (segunda 00:00 → segunda 00:00) e envia para
   * cada usuário ativo com `weeklyReport` habilitado e SCs com movimentação
   * ou pendências bloqueantes.
   */
  @Cron('0 8 * * 0', { timeZone: 'America/Sao_Paulo' })
  async handleWeeklySummary() {
    this.logger.log('Iniciando geração de resumo semanal...');
    try {
      const count =
        await this.weeklySummaryService.sendWeeklySummariesForAllUsers();
      this.logger.log(
        `Resumo semanal finalizado: ${count} e-mails enfileirados`,
      );
    } catch (err: any) {
      this.logger.error(`Erro no cron de resumo semanal: ${err?.message}`);
    }
  }

  /**
   * Limpa documentos inbound do WhatsApp que ficaram "orfãos" na pasta
   * temporária. Roda de hora em hora; remove arquivos mais antigos que
   * `AI_DOC_TMP_RETENTION_HOURS` (default 1h). Garante que documentos
   * descartados pelo usuário (sem intent) não fiquem armazenados.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredWhatsappTmpDocuments() {
    const folder = this.configService.get<string>(
      'AI_DOC_TMP_FOLDER',
      STORAGE_FOLDERS.WHATSAPP_TMP,
    );
    const retentionHours = this.configService.get<number>(
      'AI_DOC_TMP_RETENTION_HOURS',
      1,
    );
    const thresholdMs = Date.now() - retentionHours * 60 * 60 * 1000;

    try {
      const entries = await this.storageService.listFolder(folder);
      const expired = entries.filter((entry) => {
        if (!entry.createdAt) return false;
        const ts = Date.parse(entry.createdAt);
        if (Number.isNaN(ts)) return false;
        return ts < thresholdMs;
      });

      if (!expired.length) return;

      const paths = expired.map((entry) => `${folder}/${entry.name}`);
      await this.storageService.deleteMany(paths);
      this.logger.log(
        `[AI_DOC_TMP_CLEANUP] removed=${paths.length} retentionHours=${retentionHours}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_TMP_CLEANUP] erro: ${err?.message ?? String(err)}`,
      );
    }
  }
}
