import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminMetricsService } from './admin-metrics.service';
import { AdminMetricsOverviewQueryDto } from './dto/admin-metrics-query.dto';
import { AdminMetricsOverviewDto } from './dto/admin-metrics-response.dto';
import { PlatformAdminOnly } from '../auth/platform-admin-only.decorator';

@ApiTags('Admin')
@PlatformAdminOnly()
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly service: AdminMetricsService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Dashboard do painel: contas, trials, receita, churn, engajamento, IA e séries (sem chamar a Stripe)',
  })
  @ApiOkResponse({ type: AdminMetricsOverviewDto })
  overview(
    @Query() query: AdminMetricsOverviewQueryDto,
  ): Promise<AdminMetricsOverviewDto> {
    return this.service.getOverview(query.period ?? '30d');
  }
}
