import { Module } from '@nestjs/common';
import { AiToolMetricsListener } from './ai-tool-metrics.listener';
import { PlatformErrorRecorder } from './platform-errors/platform-error-recorder.service';
import { PlatformSecurityRecorder } from './platform-security/platform-security-recorder.service';

@Module({
  providers: [
    AiToolMetricsListener,
    PlatformErrorRecorder,
    PlatformSecurityRecorder,
  ],
})
export class ObservabilityModule {}
