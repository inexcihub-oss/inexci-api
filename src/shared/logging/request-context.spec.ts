import {
  getRequestContext,
  requestContextStorage,
  runWithTenantContext,
} from './request-context';

describe('runWithTenantContext', () => {
  it('fora de request, cria contexto com a conta e um requestId', () => {
    const ctx = runWithTenantContext({ tenantId: 'owner-1' }, () =>
      getRequestContext(),
    );
    expect(ctx?.tenantId).toBe('owner-1');
    expect(ctx?.userId).toBeNull();
    expect(ctx?.requestId).toEqual(expect.any(String));
    expect(getRequestContext()).toBeUndefined();
  });

  it('dentro de request, troca só a conta e preserva o resto sem alterar o contexto externo', () => {
    requestContextStorage.run(
      { requestId: 'req-1', tenantId: 'outra', userId: 'u-1' },
      () => {
        const inner = runWithTenantContext(
          { tenantId: 'owner-2', userId: 'u-2' },
          () => getRequestContext(),
        );
        expect(inner).toMatchObject({
          requestId: 'req-1',
          tenantId: 'owner-2',
          userId: 'u-2',
        });
        expect(getRequestContext()?.tenantId).toBe('outra');
      },
    );
  });
});
