import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestContext {
  requestId: string;
  userId?: string | null;
  tenantId?: string | null;
  traceId?: string | null;
  ip?: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithTenantContext<T>(
  tenant: { tenantId: string | null; userId?: string | null },
  fn: () => T,
): T {
  const current = requestContextStorage.getStore();
  return requestContextStorage.run(
    {
      ...current,
      requestId: current?.requestId ?? randomUUID(),
      tenantId: tenant.tenantId,
      userId: tenant.userId ?? current?.userId ?? null,
    },
    fn,
  );
}

export function setRequestContext(patch: Partial<RequestContext>): void {
  const current = requestContextStorage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}
