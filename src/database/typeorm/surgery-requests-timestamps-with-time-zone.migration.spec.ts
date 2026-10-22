import { QueryRunner } from 'typeorm';
import { SurgeryRequestsTimestampsWithTimeZone1761000100000 } from './migrations/1761000100000-SurgeryRequestsTimestampsWithTimeZone';

const COLUNAS: Record<string, string[]> = {
  surgery_requests: [
    'surgery_date',
    'analysis_started_at',
    'date_call',
    'sent_at',
    'surgery_performed_at',
    'closed_at',
    'last_status_changed_at',
    'created_at',
    'updated_at',
  ],
  surgery_request_activities: ['created_at'],
};

describe('SurgeryRequestsTimestampsWithTimeZone1761000100000', () => {
  function executar(sentido: 'up' | 'down') {
    const query = jest.fn().mockResolvedValue(undefined);
    return new SurgeryRequestsTimestampsWithTimeZone1761000100000()
      [sentido]({ query } as unknown as QueryRunner)
      .then(() => query.mock.calls.map(([s]) => s as string));
  }

  it('up converte cada coluna para timestamptz preservando o instante gravado', async () => {
    const comandos = await executar('up');

    for (const [tabela, colunas] of Object.entries(COLUNAS)) {
      const comando = comandos.find((c) =>
        c.includes(`ALTER TABLE "${tabela}"`),
      );
      expect(comando).toBeDefined();
      for (const coluna of colunas) {
        expect(comando).toContain(
          `ALTER COLUMN "${coluna}" TYPE TIMESTAMP WITH TIME ZONE`,
        );
        expect(comando).toContain(
          `USING "${coluna}" AT TIME ZONE current_setting('TimeZone')`,
        );
      }
    }
    expect(comandos.join('\n')).not.toMatch(/NOT NULL|UNIQUE|CONSTRAINT/);
  });

  it('down devolve as mesmas colunas para timestamp sem fuso', async () => {
    const sql = (await executar('down')).join('\n');

    for (const colunas of Object.values(COLUNAS)) {
      for (const coluna of colunas) {
        expect(sql).toContain(
          `ALTER COLUMN "${coluna}" TYPE TIMESTAMP WITHOUT TIME ZONE`,
        );
      }
    }
  });
});
