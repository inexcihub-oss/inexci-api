import { QueryRunner } from 'typeorm';
import {
  AddUniqueClinicRoomName1755801000000,
  UQ_CLINIC_ROOMS_CLINIC_NAME,
} from './migrations/1755801000000-AddUniqueClinicRoomName';
import {
  SALAS_COM_NOME_REPETIDO,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';

describe('AddUniqueClinicRoomName1755801000000', () => {
  function criarQueryRunner(conflitos: Record<string, unknown>[] = []) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === SALAS_COM_NOME_REPETIDO.sql ? conflitos : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }
  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('verifica o dado e cria o índice parcial, sem caixa, por clínica', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddUniqueClinicRoomName1755801000000().up(queryRunner);

    expect(executadas(query)).toEqual([
      SALAS_COM_NOME_REPETIDO.sql,
      `CREATE UNIQUE INDEX "${UQ_CLINIC_ROOMS_CLINIC_NAME}" ON "clinic_rooms" ("clinic_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL`,
    ]);
  });

  it('aborta com diagnóstico sem criar o índice quando há sala repetida', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { chave: 'clínica c1: consultório 1', ids: 'r-1, r-2' },
    ]);

    await expect(
      new AddUniqueClinicRoomName1755801000000().up(queryRunner),
    ).rejects.toThrow(/r-1, r-2/);
    expect(executadas(query)).toEqual([SALAS_COM_NOME_REPETIDO.sql]);
  });

  it('a verificação aponta para esta migration e roda no pré-flight', () => {
    expect(SALAS_COM_NOME_REPETIDO.migration).toBe(
      new AddUniqueClinicRoomName1755801000000().name,
    );
    expect(VERIFICACOES_PRE_MIGRATION).toContain(SALAS_COM_NOME_REPETIDO);
  });

  it('down derruba o índice', async () => {
    const { queryRunner, query } = criarQueryRunner();
    await new AddUniqueClinicRoomName1755801000000().down(queryRunner);
    expect(executadas(query)).toEqual([
      `DROP INDEX IF EXISTS "${UQ_CLINIC_ROOMS_CLINIC_NAME}"`,
    ]);
  });
});
