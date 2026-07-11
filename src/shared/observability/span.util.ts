import { inexciTracer, SpanStatusCode } from './tracer';

type SpanAttributes = Record<string, string | number | boolean>;

/**
 * Executa `fn` dentro de um span OTel ativo, registrando duração e erros.
 * Uso nos pontos críticos de performance (detalhe SC, kanban, dashboard).
 */
export async function withActiveSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  return inexciTracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    const startedAt = Date.now();
    try {
      const result = await fn();
      span.setAttribute('duration_ms', Date.now() - startedAt);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.recordException(err);
      span.setAttribute('duration_ms', Date.now() - startedAt);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw error;
    } finally {
      span.end();
    }
  });
}
