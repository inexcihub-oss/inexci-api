import { Module } from '@nestjs/common';
import { AiToolMetricsListener } from './ai-tool-metrics.listener';

@Module({
  providers: [AiToolMetricsListener],
})
export class ObservabilityModule {}
