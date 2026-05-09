import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly staleNotificationService: StaleNotificationService,
    private readonly weeklySummaryService: WeeklySummaryService,
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
}
