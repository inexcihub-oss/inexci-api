/**
 * Singleton tracer da INEXCI.
 * Importar `inexciTracer` em qualquer service para criar spans manuais.
 *
 * @example
 * ```ts
 * import { inexciTracer } from '@shared/observability/tracer';
 * import { SpanStatusCode } from '@opentelemetry/api';
 *
 * async function doWork() {
 *   return inexciTracer.startActiveSpan('ai.processMessage', async (span) => {
 *     try {
 *       const result = await heavyWork();
 *       span.setStatus({ code: SpanStatusCode.OK });
 *       return result;
 *     } catch (e: any) {
 *       span.recordException(e);
 *       span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
 *       throw e;
 *     } finally {
 *       span.end();
 *     }
 *   });
 * }
 * ```
 */
import { trace } from '@opentelemetry/api';

export const inexciTracer = trace.getTracer('inexci-api', '1.0.0');

export { SpanStatusCode, context, propagation } from '@opentelemetry/api';
