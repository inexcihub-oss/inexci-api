import { QueryRunner } from 'typeorm';
import { CONSULTA_FUSO_DO_BANCO } from './preflight/banco-em-utc';
import { RemainingTimestampsWithTimeZone1761000400000 } from './migrations/1761000400000-RemainingTimestampsWithTimeZone';

const COLUNAS: Record<string, string[]> = {
  appointments: ['created_at', 'updated_at', 'deleted_at'],
  clinic_rooms: ['created_at', 'updated_at', 'deleted_at'],
  clinics: ['created_at', 'updated_at', 'deleted_at'],
  clinical_record_templates: ['created_at', 'updated_at', 'deleted_at'],
  clinical_records: ['created_at', 'updated_at', 'deleted_at'],
  doctor_headers: ['created_at', 'updated_at'],
  doctor_profiles: ['created_at', 'updated_at'],
  health_plans: ['created_at', 'updated_at', 'deleted_at'],
  hospitals: ['created_at', 'updated_at', 'deleted_at'],
  manufacturers: ['created_at', 'updated_at', 'deleted_at'],
  opme_items: ['created_at', 'updated_at'],
  patients: ['created_at', 'updated_at', 'deleted_at'],
  payment_gateway_events: ['created_at'],
  procedures: ['created_at', 'updated_at', 'deleted_at'],
  subscription_plans: ['created_at', 'updated_at'],
  subscription_quota_periods: ['created_at', 'updated_at'],
  subscriptions: ['created_at', 'updated_at'],
  suppliers: ['created_at', 'updated_at', 'deleted_at'],
  surgery_request_activity_mentions: ['created_at'],
  surgery_request_quotations: ['created_at', 'updated_at'],
  surgery_request_templates: ['created_at', 'updated_at'],
  surgery_request_tuss_items: ['created_at', 'updated_at'],
  user_doctor_accesses: ['created_at', 'updated_at'],
  user_notification_settings: ['created_at', 'updated_at'],
  users: ['created_at', 'updated_at', 'deleted_at'],
};

describe('RemainingTimestampsWithTimeZone1761000400000', () => {
  function executar(sentido: 'up' | 'down') {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === CONSULTA_FUSO_DO_BANCO ? [{ fuso: 'UTC' }] : undefined,
      ),
    );
    return new RemainingTimestampsWithTimeZone1761000400000()
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
