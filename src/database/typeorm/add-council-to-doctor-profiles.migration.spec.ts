import { QueryRunner } from 'typeorm';
import { AddCouncilToDoctorProfiles1755800200000 } from './migrations/1755800200000-AddCouncilToDoctorProfiles';

/**
 * O `up` acrescenta `council` (default CRM) e afrouxa `crm`/`crm_state`.
 * O `down` aperta de volta e por isso olha o dado antes.
 */
describe('AddCouncilToDoctorProfiles1755800200000', () => {
  const SQL_SEM_REGISTRO = 'dp."crm" IS NULL OR dp."crm_state" IS NULL';
  const SQL_OUTRO_CONSELHO = `dp."council" IS DISTINCT FROM 'CRM'`;

  type Linha = { council: string; ids: string };

  function criarQueryRunner(semRegistro: Linha[], outroConselho: Linha[] = []) {
    const query = jest.fn((sql: string) => {
      if (sql.includes(SQL_SEM_REGISTRO)) return Promise.resolve(semRegistro);
      if (sql.includes(SQL_OUTRO_CONSELHO)) {
        return Promise.resolve(outroConselho);
      }
      return Promise.resolve(undefined);
    });
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

  it('down aborta quando há perfil de outro conselho, mesmo com número e UF', async () => {
    // Sem `council`, todo perfil volta a ser médico: o psicólogo com CRP
    // preenchido passaria a emitir receita.
    const { queryRunner, query } = criarQueryRunner(
      [],
      [{ council: 'CRP', ids: 'user-psi' }],
    );

    await expect(
      new AddCouncilToDoctorProfiles1755800200000().down(queryRunner),
    ).rejects.toThrow(/CRP[\s\S]*user-psi/);
    const sql = executadas(query);
    expect(sql.some((s) => s.includes('SET NOT NULL'))).toBe(false);
    expect(sql.some((s) => s.includes('DROP COLUMN'))).toBe(false);
  });

  it('down lista os dois tipos de conflito de uma vez', async () => {
    const { queryRunner } = criarQueryRunner(
      [{ council: 'CRN', ids: 'user-sem-numero' }],
      [{ council: 'CRN', ids: 'user-nutri' }],
    );

    const erro = await new AddCouncilToDoctorProfiles1755800200000()
      .down(queryRunner)
      .catch((e: Error) => e);

    expect(String(erro)).toMatch(/user-sem-numero/);
    expect(String(erro)).toMatch(/user-nutri/);
  });

  it('down reverte quando todo perfil é CRM com número e UF', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new AddCouncilToDoctorProfiles1755800200000().down(queryRunner);

    const sql = executadas(query).join('\n');
    expect(sql).toMatch(/SET NOT NULL/);
    expect(sql).toMatch(/DROP COLUMN "council"/);
  });
});
