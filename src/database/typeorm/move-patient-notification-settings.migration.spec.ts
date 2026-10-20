import { QueryRunner } from 'typeorm';
import {
  MovePatientNotificationSettingsToUsers1755802500000,
  TABELA_LEGADA_DE_AVISOS,
} from './migrations/1755802500000-MovePatientNotificationSettingsToUsers';

describe('MovePatientNotificationSettingsToUsers1755802500000', () => {
  function criarQueryRunner(tabelaExiste: boolean) {
    const query = jest.fn().mockResolvedValue(undefined);
    const hasTable = jest.fn().mockResolvedValue(tabelaExiste);
    return {
      queryRunner: { query, hasTable } as unknown as QueryRunner,
      query,
      hasTable,
    };
  }

  const sqlDe = (query: jest.Mock) =>
    query.mock.calls.map(([s]) => s as string);

  it('sem a tabela legada não faz nada', async () => {
    const { queryRunner, query, hasTable } = criarQueryRunner(false);

    await new MovePatientNotificationSettingsToUsers1755802500000().up(
      queryRunner,
    );

    expect(hasTable).toHaveBeenCalledWith(TABELA_LEGADA_DE_AVISOS);
    expect(query).not.toHaveBeenCalled();
  });

  it('copia as três chaves para o jsonb do dono antes de apagar a tabela', async () => {
    const { queryRunner, query } = criarQueryRunner(true);

    await new MovePatientNotificationSettingsToUsers1755802500000().up(
      queryRunner,
    );

    const [copia, remocao] = sqlDe(query);
    expect(copia).toMatch(/UPDATE "users"/);
    expect(copia).toContain(
      `'appointmentScheduled', p."appointment_scheduled"`,
    );
    expect(copia).toContain(`'appointmentReminder', p."appointment_reminder"`);
    expect(copia).toContain(
      `'appointmentCancelled', p."appointment_cancelled"`,
    );
    expect(copia).toContain(`u."id" = p."owner_id"`);
    expect(remocao).toBe(`DROP TABLE "${TABELA_LEGADA_DE_AVISOS}"`);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('down recria a tabela e devolve o que estava no jsonb', async () => {
    const { queryRunner, query } = criarQueryRunner(true);

    await new MovePatientNotificationSettingsToUsers1755802500000().down(
      queryRunner,
    );

    const [criacao, copia] = sqlDe(query);
    expect(criacao).toContain(
      `CREATE TABLE IF NOT EXISTS "${TABELA_LEGADA_DE_AVISOS}"`,
    );
    expect(copia).toContain(`INSERT INTO "${TABELA_LEGADA_DE_AVISOS}"`);
    expect(copia).toContain(`"patient_notification_settings" IS NOT NULL`);
    expect(copia).toContain('ON CONFLICT ("owner_id") DO NOTHING');
  });
});
