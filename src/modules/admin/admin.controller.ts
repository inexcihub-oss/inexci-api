import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformAdminGuard } from '../../shared/guards/platform-admin.guard';
import { AiUsageService, AiUsageReportRow } from './ai-usage.service';
import {
  AiEfficiencyService,
  AiEfficiencyReport,
} from './ai-efficiency.service';
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

class AiEfficiencyQueryDto {
  from?: string;
  to?: string;
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
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly aiUsageService: AiUsageService,
    private readonly aiEfficiencyService: AiEfficiencyService,
    private readonly notificationLogsService: NotificationLogsService,
  ) {}

  @Get('ai-usage/report')
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

  @Get('ai-efficiency/report')
  @ApiOperation({
    summary:
      'Relatório de eficiência da IA do WhatsApp (latência, cache, iterations)',
  })
  async getAiEfficiencyReport(
    @Query() query: AiEfficiencyQueryDto,
  ): Promise<AiEfficiencyReport> {
    return this.aiEfficiencyService.getReport({
      from: query.from,
      to: query.to,
    });
  }

  @Get('notification-logs')
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
