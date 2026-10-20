import { QueryRunner } from 'typeorm';
import { MakePatientCpfNullable1755800000000 } from './migrations/1755800000000-MakePatientCpfNullable';

describe('MakePatientCpfNullable1755800000000', () => {
  const SQL_SEM_CPF = 'WHERE p."cpf" IS NULL';

  function criarQueryRunner(semCpf: { owner_id: string; ids: string }[]) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(sql.includes(SQL_SEM_CPF) ? semCpf : undefined),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('up remove o NOT NULL de patients.cpf', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new MakePatientCpfNullable1755800000000().up(queryRunner);

    expect(executadas(query)).toEqual([
      'ALTER TABLE "patients" ALTER COLUMN "cpf" DROP NOT NULL',
    ]);
  });

  it('down devolve o NOT NULL quando todo paciente tem CPF', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new MakePatientCpfNullable1755800000000().down(queryRunner);

    expect(executadas(query).some((sql) => sql.includes('SET NOT NULL'))).toBe(
      true,
    );
  });

  it('down aborta sem tocar no schema quando há paciente sem CPF', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { owner_id: 'owner-a', ids: 'pac-1, pac-2' },
    ]);

    await expect(
      new MakePatientCpfNullable1755800000000().down(queryRunner),
    ).rejects.toThrow(/pac-1, pac-2/);
    expect(executadas(query).some((sql) => sql.includes('SET NOT NULL'))).toBe(
      false,
    );
  });
});
