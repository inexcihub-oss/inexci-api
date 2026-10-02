import { Ledger } from '../core/ledger';
import {
  COLUNAS_EXIGIDAS,
  formatarConferencia,
  verificarCarga,
  verificarSchema,
} from './verificacao';

describe('verificarSchema', () => {
  it('devolve as colunas que faltam', async () => {
    const todas = Object.entries(COLUNAS_EXIGIDAS).flatMap(([t, cs]) =>
      cs.map((c) => ({ table_name: t, column_name: c })),
    );
    const consultar = jest
      .fn()
      .mockResolvedValue(
        todas.filter(
          (l) => !(l.table_name === 'holidays' || l.column_name === 'council'),
        ),
      );
    await expect(verificarSchema(consultar)).resolves.toEqual([
      'doctor_profiles.council',
      'holidays.id',
    ]);
    expect(consultar.mock.calls[0][1]).toEqual([Object.keys(COLUNAS_EXIGIDAS)]);
  });

  it('schema completo → nada falta', async () => {
    const todas = Object.entries(COLUNAS_EXIGIDAS).flatMap(([t, cs]) =>
      cs.map((c) => ({ table_name: t, column_name: c })),
    );
    await expect(
      verificarSchema(jest.fn().mockResolvedValue(todas)),
    ).resolves.toEqual([]);
  });
});

describe('verificarCarga', () => {
  it('confere só as entidades do ledger, por uuid distinto, na conta do dono', async () => {
    const ledger = new Ledger(null);
    ledger.registrar('patient', '10', 'p1');
    ledger.registrar('patient', '11', 'p2');
    ledger.registrar('health_plan', '14', 'hp1');
    ledger.registrar('health_plan', '15', 'hp1'); // fundidos
    const consultar = jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('FROM patients') ? [{ n: 1 }] : [{ n: 1 }],
      );

    const linhas = await verificarCarga(consultar, ledger, 'owner-1');

    expect(linhas).toEqual([
      { rotulo: 'convênio', previstos: 1, encontrados: 1 },
      { rotulo: 'paciente', previstos: 2, encontrados: 1 },
    ]);
    expect(consultar).toHaveBeenCalledTimes(2);
    for (const [sql, params] of consultar.mock.calls) {
      expect(sql).toContain('$2');
      expect(params[1]).toBe('owner-1');
    }
  });

  it('formatar marca o que não bateu', () => {
    const texto = formatarConferencia([
      { rotulo: 'paciente', previstos: 2, encontrados: 1 },
      { rotulo: 'convênio', previstos: 1, encontrados: 1 },
    ]);
    expect(texto.split('\n')[0]).toContain('← faltando');
    expect(texto.split('\n')[1]).not.toContain('faltando');
  });
});
