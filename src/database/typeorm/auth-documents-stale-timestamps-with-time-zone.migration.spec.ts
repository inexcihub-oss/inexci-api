import { QueryRunner } from 'typeorm';
import { CONSULTA_FUSO_DO_BANCO } from './preflight/banco-em-utc';
import { AuthDocumentsStaleTimestampsWithTimeZone1761000300000 } from './migrations/1761000300000-AuthDocumentsStaleTimestampsWithTimeZone';

const COLUNAS: Record<string, string[]> = {
  recovery_codes: [
    'expires_at',
    'reset_token_expires_at',
    'created_at',
    'updated_at',
  ],
  users: ['email_verified_at', 'email_verification_expires_at'],
  documents: ['created_at', 'updated_at'],
  stale_notification_logs: ['notified_at'],
};

describe('AuthDocumentsStaleTimestampsWithTimeZone1761000300000', () => {
  function executar(sentido: 'up' | 'down') {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === CONSULTA_FUSO_DO_BANCO ? [{ fuso: 'UTC' }] : undefined,
      ),
    );
    return new AuthDocumentsStaleTimestampsWithTimeZone1761000300000()
      [sentido]({ query } as unknown as QueryRunner)
      .then(() => query.mock.calls.map(([s]) => s));
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
