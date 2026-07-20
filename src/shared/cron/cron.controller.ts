import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';
import { PlatformAdminGuard } from 'src/shared/guards/platform-admin.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class CronController {
  constructor(
    private readonly staleNotificationService: StaleNotificationService,
    private readonly weeklySummaryService: WeeklySummaryService,
  ) {}

  @Post('check-stale-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dispara verificação manual de solicitações paradas e envia notificações',
  })
  async checkStaleRequests() {
    const count =
      await this.staleNotificationService.checkAndNotifyStaleRequests();
    return { notified: count };
  }

  @Post('send-weekly-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dispara manualmente o envio do resumo semanal para todos os usuários elegíveis',
  })
  async sendWeeklySummary() {
    const dispatched =
      await this.weeklySummaryService.sendWeeklySummariesForAllUsers();
    return { dispatched };
  }
}
