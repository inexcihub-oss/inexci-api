import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StaleNotificationService } from 'src/modules/notifications/stale-notification.service';
import { WeeklySummaryService } from 'src/modules/notifications/weekly-summary.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('Admin')
@ApiBearerAuth()
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
  async checkStaleRequests(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Apenas administradores podem executar esta ação',
      );
    }
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
  async sendWeeklySummary(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Apenas administradores podem executar esta ação',
      );
    }
    const dispatched =
      await this.weeklySummaryService.sendWeeklySummariesForAllUsers();
    return { dispatched };
  }
}
