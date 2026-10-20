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
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';

@ApiTags('Relatórios')
@ApiBearerAuth()
@Controller('reports')
@RequirePermission(Permission.SOLICITACOES)
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

  @Get('dashboard-full')
  @ApiOperation({
    summary: 'Dashboard consolidado (KPIs + evoluções + tempo médio + alertas)',
  })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'months', required: false })
  @ApiQuery({ name: 'hospitalId', required: false })
  @ApiQuery({ name: 'healthPlanId', required: false })
  @ApiQuery({ name: 'startDate', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'endDate', required: false, description: 'ISO date' })
  dashboardFull(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
    @Query('months') months?: string,
    @Query('hospitalId') hospitalId?: string,
    @Query('healthPlanId') healthPlanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.dashboardFull(
      user.userId,
      this.buildFilters({ hospitalId, healthPlanId, startDate, endDate }),
      days ? parseInt(days, 10) : 30,
      months ? parseInt(months, 10) : 6,
    );
  }
}
