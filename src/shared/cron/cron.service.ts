import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import { FotosPacienteOrfasService } from './fotos-paciente-orfas.service';
import { errorMessage } from 'src/shared/utils/error-message.util';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly staleNotificationService: StaleNotificationService,
    private readonly weeklySummaryService: WeeklySummaryService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly fotosPacienteOrfasService: FotosPacienteOrfasService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleStaleNotifications() {
    this.logger.log('Iniciando verificação de solicitações paradas (stale)...');
    try {
      const count =
        await this.staleNotificationService.checkAndNotifyStaleRequests();
      this.logger.log(`Stale check finalizado: ${count} notificações enviadas`);
    } catch (err) {
      this.logger.error(`Erro no cron de stale: ${errorMessage(err)}`);
    }
  }

  @Cron('0 8 * * 0', { timeZone: 'America/Sao_Paulo' })
  async handleWeeklySummary() {
    this.logger.log('Iniciando geração de resumo semanal...');
    try {
      const count =
        await this.weeklySummaryService.sendWeeklySummariesForAllUsers();
      this.logger.log(
        `Resumo semanal finalizado: ${count} e-mails enfileirados`,
      );
    } catch (err) {
      this.logger.error(`Erro no cron de resumo semanal: ${errorMessage(err)}`);
    }
  }

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
    } catch (err) {
      this.logger.warn(`[AI_DOC_TMP_CLEANUP] erro: ${errorMessage(err)}`);
    }
  }

  @Cron('30 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async cleanupOrphanPatientPhotos() {
    try {
      const { removidas, falhas } =
        await this.fotosPacienteOrfasService.limpar();
      if (removidas || falhas) {
        this.logger.log(
          `[PATIENT_PHOTOS_CLEANUP] removed=${removidas} failed=${falhas}`,
        );
      }
    } catch (err) {
      this.logger.warn(`[PATIENT_PHOTOS_CLEANUP] erro: ${errorMessage(err)}`);
    }
  }
}
