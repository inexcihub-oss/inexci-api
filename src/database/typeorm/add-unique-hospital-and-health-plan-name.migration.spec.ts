import { QueryRunner } from 'typeorm';
import {
  AddUniqueHospitalAndHealthPlanName1755801700000,
  UQ_HEALTH_PLANS_OWNER_NAME,
  UQ_HOSPITALS_OWNER_NAME,
} from './migrations/1755801700000-AddUniqueHospitalAndHealthPlanName';
import {
  HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';
import { HOSPITAL_NOME_UNICO } from '../entities/hospital.entity';
import { HEALTH_PLAN_NOME_UNICO } from '../entities/health-plan.entity';

describe('AddUniqueHospitalAndHealthPlanName1755801700000', () => {
  function criarQueryRunner(conflitos: Record<string, unknown>[] = []) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO.sql
          ? conflitos
          : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }
  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('verifica o dado e cria os índices parciais, sem caixa, por conta', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddUniqueHospitalAndHealthPlanName1755801700000().up(queryRunner);

    expect(executadas(query)).toEqual([
      HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO.sql,
      `CREATE UNIQUE INDEX "${UQ_HOSPITALS_OWNER_NAME}" ON "hospitals" ("owner_id", lower("name")) WHERE "deleted_at" IS NULL`,
      `CREATE UNIQUE INDEX "${UQ_HEALTH_PLANS_OWNER_NAME}" ON "health_plans" ("owner_id", lower("name")) WHERE "deleted_at" IS NULL`,
    ]);
  });

  it('aborta com diagnóstico sem criar índice quando há nome repetido', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { tipo: 'hospital', owner_id: 'o1', nome: 'santa casa', ids: 'h-1, h-2' },
    ]);

    await expect(
      new AddUniqueHospitalAndHealthPlanName1755801700000().up(queryRunner),
    ).rejects.toThrow(/hospital da conta o1: santa casa -> h-1, h-2/);
    expect(executadas(query)).toEqual([
      HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO.sql,
    ]);
  });

  it('a verificação aponta para esta migration e roda no pré-flight', () => {
    expect(HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO.migration).toBe(
      new AddUniqueHospitalAndHealthPlanName1755801700000().name,
    );
    expect(VERIFICACOES_PRE_MIGRATION).toContain(
      HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO,
    );
  });

  it('as entidades declaram os mesmos nomes de índice', () => {
    expect(HOSPITAL_NOME_UNICO).toBe(UQ_HOSPITALS_OWNER_NAME);
    expect(HEALTH_PLAN_NOME_UNICO).toBe(UQ_HEALTH_PLANS_OWNER_NAME);
  });

  it('down derruba os índices', async () => {
    const { queryRunner, query } = criarQueryRunner();
    await new AddUniqueHospitalAndHealthPlanName1755801700000().down(
      queryRunner,
    );
    expect(executadas(query)).toEqual([
      `DROP INDEX IF EXISTS "${UQ_HEALTH_PLANS_OWNER_NAME}"`,
      `DROP INDEX IF EXISTS "${UQ_HOSPITALS_OWNER_NAME}"`,
    ]);
  });
});
