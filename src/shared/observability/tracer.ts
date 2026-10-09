import { trace } from '@opentelemetry/api';

export const inexciTracer = trace.getTracer('inexci-api', '1.0.0');

export { SpanStatusCode, context, propagation } from '@opentelemetry/api';
