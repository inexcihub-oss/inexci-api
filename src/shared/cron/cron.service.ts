import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly staleNotificationService: StaleNotificationService,
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
}
