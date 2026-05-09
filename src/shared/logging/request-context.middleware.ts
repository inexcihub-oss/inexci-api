import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from './request-context';

/**
 * Middleware Express que estabelece o contexto de requisição para todo o
 * resto do pipeline (controllers, interceptors, services, repositories).
 *
 * Estratégia:
 * 1. Lê `X-Request-Id` do header; se ausente, gera um UUID v4 novo.
 * 2. Reflete o id na resposta (`X-Request-Id`) — o frontend usa para
 *    correlacionar erros e o suporte para abrir tickets.
 * 3. Empurra `requestId` no `AsyncLocalStorage` antes de seguir o pipeline.
 *
 * `userId`/`tenantId` são populados depois pelo `JwtAuthGuard` (Fase 3.5).
 */
const HEADER = 'x-request-id';

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = (req.headers[HEADER] as string | undefined)?.trim();
  const requestId =
    incoming && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();

  res.setHeader('X-Request-Id', requestId);
  (req as Request & { requestId: string }).requestId = requestId;

  requestContextStorage.run({ requestId }, () => next());
}
