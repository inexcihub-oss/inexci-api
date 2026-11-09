import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AiUsageService } from './ai-usage.service';
import { AiUsageQueryDto, AiUsageReportRowDto } from './dto/ai-usage.dto';
import {
  AiEfficiencyService,
  AiEfficiencyReport,
} from './ai-efficiency.service';
import { AiEfficiencyQueryDto } from './dto/ai-efficiency-query.dto';
import { NotificationLogsService } from './notification-logs.service';
import {
  NotificationLogListResponseDto,
  NotificationLogsQueryDto,
  NotificationLogsStatsQueryDto,
  NotificationLogStatsRowDto,
} from './envios/dto/notification-logs.dto';
import { PlatformAdminOnly } from './auth/platform-admin-only.decorator';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly aiUsageService: AiUsageService,
    private readonly aiEfficiencyService: AiEfficiencyService,
    private readonly notificationLogsService: NotificationLogsService,
  ) {}

  @Get('ai-usage/report')
  @ApiOperation({
    summary:
      'Relatório de uso de IA (por usuário, conta, modelo ou dia), custo em US$',
  })
  @ApiOkResponse({ type: [AiUsageReportRowDto] })
  async getAiUsageReport(
    @Query() query: AiUsageQueryDto,
  ): Promise<AiUsageReportRowDto[]> {
    return this.aiUsageService.getReport(query);
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
    summary:
      'Lista logs de envio (e-mail + WhatsApp) sem conteúdo e com destinatário mascarado',
  })
  @ApiOkResponse({ type: NotificationLogListResponseDto })
  listNotificationLogs(
    @Query() query: NotificationLogsQueryDto,
  ): Promise<NotificationLogListResponseDto> {
    return this.notificationLogsService.list(query);
  }

  @Get('notification-logs/stats')
  @ApiOperation({
    summary: 'Estatísticas agregadas de envio por canal e status',
  })
  @ApiOkResponse({ type: [NotificationLogStatsRowDto] })
  notificationLogsStats(
    @Query() query: NotificationLogsStatsQueryDto,
  ): Promise<NotificationLogStatsRowDto[]> {
    return this.notificationLogsService.stats(query);
  }
}
