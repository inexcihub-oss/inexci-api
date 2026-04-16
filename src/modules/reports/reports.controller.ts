import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Relatórios')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard geral' })
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.dashboard(user.userId);
  }

  @Get('temporal-evolution')
  @ApiOperation({ summary: 'Evolução temporal' })
  @ApiQuery({ name: 'days', required: false })
  temporalEvolution(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
  ) {
    const daysNumber = days ? parseInt(days, 10) : 30;
    return this.reportsService.temporalEvolution(user.userId, daysNumber);
  }

  @Get('average-completion-time')
  @ApiOperation({ summary: 'Tempo médio de conclusão' })
  averageCompletionTime(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.averageCompletionTime(user.userId);
  }

  @Get('pending-notifications')
  @ApiOperation({ summary: 'Notificações pendentes' })
  pendingNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.pendingNotifications(user.userId);
  }

  @Get('monthly-evolution')
  @ApiOperation({ summary: 'Evolução mensal' })
  @ApiQuery({ name: 'months', required: false })
  monthlyEvolution(
    @CurrentUser() user: AuthenticatedUser,
    @Query('months') months?: string,
  ) {
    const monthsNumber = months ? parseInt(months, 10) : 6;
    return this.reportsService.monthlyEvolution(user.userId, monthsNumber);
  }
}
