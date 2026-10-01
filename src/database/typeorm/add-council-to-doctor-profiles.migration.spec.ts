import { QueryRunner } from 'typeorm';
import { AddCouncilToDoctorProfiles1755800200000 } from './migrations/1755800200000-AddCouncilToDoctorProfiles';

/**
 * O `up` acrescenta `council` (default CRM) e afrouxa `crm`/`crm_state`.
 * O `down` aperta de volta e por isso olha o dado antes.
 */
describe('AddCouncilToDoctorProfiles1755800200000', () => {
  const SQL_SEM_REGISTRO = 'dp."crm" IS NULL OR dp."crm_state" IS NULL';

  function criarQueryRunner(semRegistro: { council: string; ids: string }[]) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(sql.includes(SQL_SEM_REGISTRO) ? semRegistro : undefined),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('up cria council com default CRM e afrouxa crm/crm_state', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new AddCouncilToDoctorProfiles1755800200000().up(queryRunner);

    const sql = executadas(query).join('\n');
    expect(sql).toMatch(/ADD COLUMN "council"[^\n]*DEFAULT 'CRM'/);
    expect(sql).toMatch(/"crm" DROP NOT NULL/);
    expect(sql).toMatch(/"crm_state" DROP NOT NULL/);
  });

  it('down aborta sem tocar no schema quando há perfil sem número/UF', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { council: 'CRN', ids: 'user-1' },
    ]);

    await expect(
      new AddCouncilToDoctorProfiles1755800200000().down(queryRunner),
    ).rejects.toThrow(/user-1/);
    expect(executadas(query).some((s) => s.includes('SET NOT NULL'))).toBe(
      false,
    );
  });

  it('down reverte quando todo perfil tem número e UF', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new AddCouncilToDoctorProfiles1755800200000().down(queryRunner);

    const sql = executadas(query).join('\n');
    expect(sql).toMatch(/SET NOT NULL/);
    expect(sql).toMatch(/DROP COLUMN "council"/);
  });
});
