import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.dashboard(user.userId);
  }

  @Get('temporal-evolution')
  temporalEvolution(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
  ) {
    const daysNumber = days ? parseInt(days, 10) : 30;
    return this.reportsService.temporalEvolution(user.userId, daysNumber);
  }

  @Get('average-completion-time')
  averageCompletionTime(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.averageCompletionTime(user.userId);
  }

  @Get('pending-notifications')
  pendingNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.pendingNotifications(user.userId);
  }

  @Get('monthly-evolution')
  monthlyEvolution(
    @CurrentUser() user: AuthenticatedUser,
    @Query('months') months?: string,
  ) {
    const monthsNumber = months ? parseInt(months, 10) : 6;
    return this.reportsService.monthlyEvolution(user.userId, monthsNumber);
  }
}
