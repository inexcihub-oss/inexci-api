import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string | null;
  tenantId?: string | null;
  traceId?: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function setRequestContext(patch: Partial<RequestContext>): void {
  const current = requestContextStorage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}
