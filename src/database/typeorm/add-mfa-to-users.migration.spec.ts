import { QueryRunner } from 'typeorm';
import { AddMfaToUsers1755802410000 } from './migrations/1755802410000-AddMfaToUsers';

describe('AddMfaToUsers1755802410000', () => {
  function criarQueryRunner() {
    const query = jest.fn().mockResolvedValue(undefined);
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const COLUNAS = [
    'mfa_secret',
    'mfa_pending_secret',
    'mfa_enabled_at',
    'mfa_recovery_codes',
    'mfa_last_used_step',
  ];

  it('up só adiciona colunas anuláveis, sem default nem restrição', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddMfaToUsers1755802410000().up(queryRunner);

    const sql = query.mock.calls.map(([s]) => s as string).join('\n');
    for (const coluna of COLUNAS) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${coluna}"`);
    }
    expect(sql).not.toMatch(/NOT NULL|UNIQUE|CONSTRAINT|DEFAULT/);
    expect(sql).toMatch(/"mfa_recovery_codes" text\[\]/);
    expect(sql).toMatch(/"mfa_enabled_at" TIMESTAMP WITH TIME ZONE/);
  });

  it('down remove as cinco colunas', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddMfaToUsers1755802410000().down(queryRunner);

    const sql = query.mock.calls.map(([s]) => s as string).join('\n');
    for (const coluna of COLUNAS) {
      expect(sql).toContain(`DROP COLUMN IF EXISTS "${coluna}"`);
    }
  });
});
