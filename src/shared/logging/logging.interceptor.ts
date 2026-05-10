import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { getRequestContext, setRequestContext } from './request-context';

/**
 * Interceptor global que loga uma linha estruturada por request HTTP
 * (`event=http_request`) com método, URL sanitizada, status, duração,
 * userId quando disponível e IP. Também espelha o `userId`/`tenantId` do
 * `request.user` (populado pelo `JwtAuthGuard`) no `AsyncLocalStorage`,
 * permitindo que logs subsequentes herdem esses campos.
 *
 * Saída intencionalmente compacta — campos detalhados (headers, body) NUNCA
 * são logados aqui para não vazar PII.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Http');
  private readonly traceLogger = new Logger('Trace');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: any; requestId?: string }>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();

    // O payload do JwtStrategy.validate() expõe `userId` (não `id`).
    // Mantemos `id` como fallback para qualquer outra estratégia de auth
    // que populasse `req.user.id` diretamente.
    if (req.user) {
      setRequestContext({
        userId: req.user?.userId ?? req.user?.id ?? null,
        tenantId: req.user?.ownerId ?? req.user?.accountId ?? null,
      });
    }

    const handlerLabel = `${context.getClass().name}.${context.getHandler().name}`;
    this.traceLogger.log(
      `→ ${handlerLabel} ${req.method} ${sanitizeUrl(req.originalUrl || req.url || '')}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          this.traceLogger.log(
            `← ${handlerLabel} (${Date.now() - startedAt}ms)`,
          );
          this.emit(req, res, startedAt);
        },
        error: (err: unknown) => {
          const reason =
            err instanceof Error ? err.message : 'erro desconhecido';
          this.traceLogger.error(
            `✗ ${handlerLabel} (${Date.now() - startedAt}ms) — ${reason}`,
          );
          this.emit(req, res, startedAt);
        },
      }),
    );
  }

  private emit(req: Request, res: Response, startedAt: number): void {
    const ctx = getRequestContext();
    const durationMs = Date.now() - startedAt;
    const url = sanitizeUrl(req.originalUrl || req.url || '');
    const method = req.method;
    const statusCode = res.statusCode;

    const payload = JSON.stringify({
      event: 'http_request',
      method,
      url,
      statusCode,
      durationMs,
      userId: ctx?.userId ?? null,
      tenantId: ctx?.tenantId ?? null,
      ip: req.ip || null,
    });

    if (statusCode >= 500) {
      this.logger.error(payload);
    } else if (statusCode >= 400) {
      this.logger.warn(payload);
    } else {
      this.logger.log(payload);
    }
  }
}

/**
 * Remove valores potencialmente sensíveis da query string (token, code,
 * password) antes de gravar a URL no log.
 */
const SENSITIVE_QS_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'code',
  'password',
  'cpf',
  'phone',
]);

function sanitizeUrl(originalUrl: string): string {
  if (!originalUrl) return '';
  const queryStart = originalUrl.indexOf('?');
  if (queryStart === -1) return originalUrl;
  const path = originalUrl.slice(0, queryStart);
  const query = originalUrl.slice(queryStart + 1);
  const cleaned = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return SENSITIVE_QS_KEYS.has(key.toLowerCase()) ? `${key}=***` : pair;
    })
    .join('&');
  return `${path}?${cleaned}`;
}
