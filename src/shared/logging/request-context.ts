import { AsyncLocalStorage } from 'async_hooks';

/**
 * Contexto da requisição em curso. Propagado via AsyncLocalStorage para que
 * qualquer log emitido dentro do escopo (síncrono ou assíncrono) carregue
 * o `requestId`/`userId`/`tenantId` automaticamente.
 *
 * Workers Bull repopulam o store ao iniciar o processamento de um job,
 * lendo o `requestId` do payload (ver `processors` correspondentes).
 */
export interface RequestContext {
  requestId: string;
  userId?: string | null;
  tenantId?: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Retorna o contexto atual ou `undefined` quando não há um (cron, startup,
 * scripts standalone). Callers devem tratar ausência sem panic.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Conveniência para enriquecer o contexto in-place — útil quando o `userId`
 * só fica disponível depois do `JwtAuthGuard.validate`.
 */
export function setRequestContext(patch: Partial<RequestContext>): void {
  const current = requestContextStorage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}
