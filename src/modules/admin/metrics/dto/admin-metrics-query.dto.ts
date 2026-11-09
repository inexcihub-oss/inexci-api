import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { METRICS_PERIODS, MetricsPeriod } from '../metrics-formulas';

export class AdminMetricsOverviewQueryDto {
  @ApiPropertyOptional({ enum: METRICS_PERIODS, default: '30d' })
  @IsOptional()
  @IsIn(METRICS_PERIODS)
  period?: MetricsPeriod;
}
