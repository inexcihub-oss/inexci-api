import { QueryRunner } from 'typeorm';
import { CONSULTA_FUSO_DO_BANCO } from './preflight/banco-em-utc';
import { NotificationsTimestampsWithTimeZone1761000000000 } from './migrations/1761000000000-NotificationsTimestampsWithTimeZone';

describe('NotificationsTimestampsWithTimeZone1761000000000', () => {
  function criarQueryRunner() {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === CONSULTA_FUSO_DO_BANCO ? [{ fuso: 'UTC' }] : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  it('up converte as duas colunas para timestamptz preservando o instante gravado', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new NotificationsTimestampsWithTimeZone1761000000000().up(
      queryRunner,
    );

    const sql = query.mock.calls.map(([s]) => s).join('\n');
    for (const coluna of ['created_at', 'updated_at']) {
      expect(sql).toContain(
        `ALTER COLUMN "${coluna}" TYPE TIMESTAMP WITH TIME ZONE`,
      );
      expect(sql).toContain(
        `USING "${coluna}" AT TIME ZONE current_setting('TimeZone')`,
      );
    }
    expect(sql).not.toMatch(/NOT NULL|UNIQUE|CONSTRAINT/);
  });

  it('down volta para timestamp sem fuso', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new NotificationsTimestampsWithTimeZone1761000000000().down(
      queryRunner,
    );

    const sql = query.mock.calls.map(([s]) => s).join('\n');
    expect(sql).toContain('TYPE TIMESTAMP WITHOUT TIME ZONE');
  });
});
