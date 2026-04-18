import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ReportsService, ReportFilters } from './reports.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Relatórios')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  private buildFilters(query: {
    hospitalId?: string;
    healthPlanId?: string;
    startDate?: string;
    endDate?: string;
  }): ReportFilters {
    return {
      hospitalId: query.hospitalId || undefined,
      healthPlanId: query.healthPlanId || undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    };
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard geral' })
  @ApiQuery({ name: 'hospitalId', required: false })
  @ApiQuery({ name: 'healthPlanId', required: false })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'ISO date string',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'ISO date string',
  })
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('hospitalId') hospitalId?: string,
    @Query('healthPlanId') healthPlanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.dashboard(
      user.userId,
      this.buildFilters({ hospitalId, healthPlanId, startDate, endDate }),
    );
  }

  @Get('temporal-evolution')
  @ApiOperation({ summary: 'Evolução temporal' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'hospitalId', required: false })
  @ApiQuery({ name: 'healthPlanId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  temporalEvolution(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
    @Query('hospitalId') hospitalId?: string,
    @Query('healthPlanId') healthPlanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const daysNumber = days ? parseInt(days, 10) : 30;
    return this.reportsService.temporalEvolution(
      user.userId,
      daysNumber,
      this.buildFilters({ hospitalId, healthPlanId, startDate, endDate }),
    );
  }

  @Get('average-completion-time')
  @ApiOperation({ summary: 'Tempo médio de conclusão' })
  @ApiQuery({ name: 'hospitalId', required: false })
  @ApiQuery({ name: 'healthPlanId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  averageCompletionTime(
    @CurrentUser() user: AuthenticatedUser,
    @Query('hospitalId') hospitalId?: string,
    @Query('healthPlanId') healthPlanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.averageCompletionTime(
      user.userId,
      this.buildFilters({ hospitalId, healthPlanId, startDate, endDate }),
    );
  }

  @Get('pending-notifications')
  @ApiOperation({ summary: 'Notificações pendentes' })
  @ApiQuery({ name: 'hospitalId', required: false })
  @ApiQuery({ name: 'healthPlanId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  pendingNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('hospitalId') hospitalId?: string,
    @Query('healthPlanId') healthPlanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.pendingNotifications(
      user.userId,
      this.buildFilters({ hospitalId, healthPlanId, startDate, endDate }),
    );
  }

  @Get('monthly-evolution')
  @ApiOperation({ summary: 'Evolução mensal' })
  @ApiQuery({ name: 'months', required: false })
  @ApiQuery({ name: 'hospitalId', required: false })
  @ApiQuery({ name: 'healthPlanId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  monthlyEvolution(
    @CurrentUser() user: AuthenticatedUser,
    @Query('months') months?: string,
    @Query('hospitalId') hospitalId?: string,
    @Query('healthPlanId') healthPlanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const monthsNumber = months ? parseInt(months, 10) : 6;
    return this.reportsService.monthlyEvolution(
      user.userId,
      monthsNumber,
      this.buildFilters({ hospitalId, healthPlanId, startDate, endDate }),
    );
  }
}
