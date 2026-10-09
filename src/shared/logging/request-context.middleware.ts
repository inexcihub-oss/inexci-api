import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from './request-context';

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
