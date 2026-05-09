import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../shared/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { AiUsageService, AiUsageReportRow } from './ai-usage.service';
import {
  NotificationLogsService,
  NotificationLogQuery,
  NotificationLogStatsRow,
} from './notification-logs.service';
import {
  NotificationChannel,
  NotificationSendLog,
  NotificationSendStatus,
} from '../../database/entities/notification-send-log.entity';

class AiUsageQueryDto {
  from?: string;
  to?: string;
  groupBy?: 'user' | 'model' | 'day';
}

class NotificationLogsQueryDto {
  channel?: NotificationChannel;
  status?: NotificationSendStatus;
  ownerId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly aiUsageService: AiUsageService,
    private readonly notificationLogsService: NotificationLogsService,
  ) {}

  @Get('ai-usage/report')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Relatório de uso de IA (custo por usuário/mês/modelo)',
  })
  async getAiUsageReport(
    @Query() query: AiUsageQueryDto,
  ): Promise<AiUsageReportRow[]> {
    return this.aiUsageService.getReport({
      from: query.from,
      to: query.to,
      groupBy: query.groupBy,
    });
  }

  /**
   * Lista paginada de envios (e-mail + WhatsApp). Body/errorMessage já
   * chegam truncados em VARCHAR(600); o cron `LogRetentionService` apaga
   * registros após `LOG_RETENTION_NOTIFICATION_DAYS` dias.
   */
  @Get('notification-logs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Lista logs de envio (e-mail + WhatsApp) — somente admin',
  })
  async listNotificationLogs(
    @Query() query: NotificationLogsQueryDto,
  ): Promise<{ items: NotificationSendLog[]; total: number }> {
    const limit = query.limit ? Number(query.limit) : undefined;
    const offset = query.offset ? Number(query.offset) : undefined;
    const params: NotificationLogQuery = { ...query, limit, offset };
    return this.notificationLogsService.list(params);
  }

  @Get('notification-logs/stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Estatísticas agregadas de envio por canal e status',
  })
  async notificationLogsStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<NotificationLogStatsRow[]> {
    return this.notificationLogsService.stats(from, to);
  }
}
