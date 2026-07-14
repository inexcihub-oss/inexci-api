/**
 * Fase 2 do `PLANO-OBSERVABILIDADE-GRAFANA.md`.
 *
 * Converte os eventos de telemetria já emitidos por `ToolExecutorService`
 * (`tool_succeeded`/`tool_failed`) em métricas OTel (`inexci.ai.tool.duration`),
 * sem tocar na lógica de execução de tools em `shared/ai/`.
 */
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
