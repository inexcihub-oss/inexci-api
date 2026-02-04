import { Controller, Get, Request, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  dashboard(@Request() req) {
    return this.reportsService.dashboard(req.user.userId);
  }

  @Get('temporal-evolution')
  temporalEvolution(@Request() req, @Query('days') days?: string) {
    const daysNumber = days ? parseInt(days, 10) : 30;
    return this.reportsService.temporalEvolution(req.user.userId, daysNumber);
  }

  @Get('average-completion-time')
  averageCompletionTime(@Request() req) {
    return this.reportsService.averageCompletionTime(req.user.userId);
  }

  @Get('pending-notifications')
  pendingNotifications(@Request() req) {
    return this.reportsService.pendingNotifications(req.user.userId);
  }

  @Get('monthly-evolution')
  monthlyEvolution(@Request() req, @Query('months') months?: string) {
    const monthsNumber = months ? parseInt(months, 10) : 6;
    return this.reportsService.monthlyEvolution(req.user.userId, monthsNumber);
  }
}
