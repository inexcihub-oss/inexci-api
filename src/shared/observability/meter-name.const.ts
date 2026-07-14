/**
 * Nome do meter OTel da API, compartilhado entre `otel.ts` (registro do
 * `View`/histograma) e `metrics.util.ts` (criação dos instrumentos).
 *
 * Vive em arquivo próprio, sem nenhum outro import, para que `otel.ts` possa
 * referenciá-lo SEM carregar `metrics.util.ts` antes da hora. Se `otel.ts`
 * importasse `metrics.util.ts` diretamente, os `createHistogram`/`createCounter`
 * de nível de módulo daquele arquivo rodariam antes de `initOtel()` chamar
 * `sdk.start()` — a API de métricas do OTel (diferente da de traces) não tem
 * delegação tardia, então os instrumentos ficariam presos ao MeterProvider
 * noop para sempre, e nada seria exportado ao Grafana Cloud.
 */
export const METER_NAME = 'inexci-api';
