import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { recordAiToolDuration } from './metrics.util';

interface ToolTelemetryEventPayload {
  toolName: string;
  durationMs: number;
}

@Injectable()
export class AiToolMetricsListener {
  @OnEvent('tool_succeeded')
  onToolSucceeded(event: ToolTelemetryEventPayload): void {
    recordAiToolDuration(event.durationMs, { tool: event.toolName });
  }

  @OnEvent('tool_failed')
  onToolFailed(event: ToolTelemetryEventPayload): void {
    recordAiToolDuration(event.durationMs, { tool: event.toolName });
  }
}
