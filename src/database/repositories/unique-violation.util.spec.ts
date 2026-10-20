import { violacaoDeUnicidade, violouIndice } from './unique-violation.util';

describe('violacaoDeUnicidade / violouIndice', () => {
  it('reconhece o 23505 cru e o embrulhado em driverError', () => {
    expect(violacaoDeUnicidade({ code: '23505', constraint: 'uq_x' })).toEqual({
      constraint: 'uq_x',
    });
    expect(
      violacaoDeUnicidade({
        driverError: { code: '23505', constraint: 'uq_y' },
      }),
    ).toEqual({ constraint: 'uq_y' });
  });

  it('ignora outros erros e valores não-objeto', () => {
    expect(violacaoDeUnicidade({ code: '23503' })).toBeNull();
    expect(violacaoDeUnicidade(null)).toBeNull();
    expect(violacaoDeUnicidade('23505')).toBeNull();
  });

  it('violouIndice confere a constraint ou, na falta, a mensagem', () => {
    expect(violouIndice({ code: '23505', constraint: 'idx_a' }, 'idx_a')).toBe(
      true,
    );
    expect(
      violouIndice(
        { driverError: { code: '23505', message: 'duplicate key "idx_a"' } },
        'idx_a',
      ),
    ).toBe(true);
    expect(violouIndice({ code: '23505', constraint: 'idx_b' }, 'idx_a')).toBe(
      false,
    );
    expect(violouIndice({ code: '23503', constraint: 'idx_a' }, 'idx_a')).toBe(
      false,
    );
  });
});
