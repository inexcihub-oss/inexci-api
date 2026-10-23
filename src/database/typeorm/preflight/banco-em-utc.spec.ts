import { CONSULTA_FUSO_DO_BANCO, exigirBancoEmUtc } from './banco-em-utc';
import { NotificationsTimestampsWithTimeZone1761000000000 } from '../migrations/1761000000000-NotificationsTimestampsWithTimeZone';

describe('exigirBancoEmUtc', () => {
  const comFuso = (fuso: string | undefined) => ({
    query: jest.fn((sql: string) =>
      Promise.resolve(sql === CONSULTA_FUSO_DO_BANCO ? [{ fuso }] : undefined),
    ),
  });

  it.each(['UTC', 'Etc/UTC', 'GMT', 'utc'])(
    'libera o fuso %s',
    async (fuso) => {
      await expect(
        exigirBancoEmUtc(comFuso(fuso) as never, 'Migration1'),
      ).resolves.toBeUndefined();
    },
  );

  it.each(['America/Sao_Paulo', undefined])(
    'bloqueia com diagnóstico o fuso %s',
    async (fuso) => {
      await expect(
        exigirBancoEmUtc(comFuso(fuso) as never, 'Migration1'),
      ).rejects.toThrow(
        /Migration1 bloqueada: a sessão do Postgres está no fuso/,
      );
    },
  );

  it('a migration de datas não altera nenhuma coluna fora de UTC', async () => {
    const queryRunner = comFuso('America/Sao_Paulo');

    await expect(
      new NotificationsTimestampsWithTimeZone1761000000000().up(
        queryRunner as never,
      ),
    ).rejects.toThrow(/America\/Sao_Paulo/);
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
  });
});
