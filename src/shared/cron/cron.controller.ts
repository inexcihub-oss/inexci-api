import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';
import { AuthenticatedAdmin } from 'src/modules/admin/auth/admin-session.guard';
import {
  CurrentAdmin,
  PlatformAdminOnly,
} from 'src/modules/admin/auth/platform-admin-only.decorator';
import { AdminSystemService } from 'src/modules/admin/system/admin-system.service';
import {
  RunSystemJobDto,
  StaleRequestsRunResultDto,
  WeeklySummaryRunResultDto,
} from 'src/modules/admin/system/dto/system-jobs.dto';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin')
export class CronController {
  constructor(
    private readonly staleNotificationService: StaleNotificationService,
    private readonly weeklySummaryService: WeeklySummaryService,
    private readonly systemService: AdminSystemService,
  ) {}

  @Post('check-stale-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dispara verificação manual de solicitações paradas e envia notificações',
  })
  @ApiOkResponse({ type: StaleRequestsRunResultDto })
  @ApiConflictResponse({ description: 'A tarefa já está em execução' })
  checkStaleRequests(
    @Body() dto: RunSystemJobDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<StaleRequestsRunResultDto> {
    return this.systemService.runManual(
      'stale_requests',
      { reason: dto.reason, actorAdminId: admin.adminId },
      async () => ({
        notified:
          await this.staleNotificationService.checkAndNotifyStaleRequests(),
      }),
    );
  }

  @Post('send-weekly-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dispara manualmente o envio do resumo semanal para todos os usuários elegíveis',
  })
  @ApiOkResponse({ type: WeeklySummaryRunResultDto })
  @ApiConflictResponse({ description: 'A tarefa já está em execução' })
  sendWeeklySummary(
    @Body() dto: RunSystemJobDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<WeeklySummaryRunResultDto> {
    return this.systemService.runManual(
      'weekly_summary',
      { reason: dto.reason, actorAdminId: admin.adminId },
      async () => ({
        dispatched:
          await this.weeklySummaryService.sendWeeklySummariesForAllUsers(),
      }),
    );
  }
}
