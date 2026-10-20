import { QueryRunner, getMetadataArgsStorage } from 'typeorm';
import { AddAppointmentsNoOverlapConstraint1755800900000 } from './migrations/1755800900000-AddAppointmentsNoOverlapConstraint';
import {
  APPOINTMENTS_NO_OVERLAP_CONSTRAINT,
  APPOINTMENTS_NO_OVERLAP_EXCLUSION,
  Appointment,
  OCCUPYING_APPOINTMENT_STATUSES,
} from '../entities/appointment.entity';
import {
  CONSULTAS_SOBREPOSTAS,
  EXTENSAO_BTREE_GIST,
  STATUS_QUE_OCUPAM_A_AGENDA_SQL,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';

describe('AddAppointmentsNoOverlapConstraint1755800900000', () => {
  function criarQueryRunner(
    conflitos: Record<string, unknown>[] = [],
    nomesAtuais: Record<string, string | null> = {},
    semExtensao: Record<string, unknown>[] = [],
  ) {
    const query = jest.fn((sql: string, params?: unknown[]) => {
      if (sql === CONSULTAS_SOBREPOSTAS.sql) return Promise.resolve(conflitos);
      if (sql === EXTENSAO_BTREE_GIST.sql) return Promise.resolve(semExtensao);
      if (sql.includes('pg_constraint')) {
        const coluna = String(params?.[0]);
        const nome =
          coluna in nomesAtuais
            ? nomesAtuais[coluna]
            : `appointments_${coluna}_fkey`;
        return Promise.resolve(nome ? [{ nome }] : []);
      }
      return Promise.resolve(undefined);
    });
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const executadas = (query: jest.Mock) =>
    query.mock.calls
      .map(([sql]) => sql as string)
      .filter((sql) => !sql.includes('pg_constraint'));

  async function sqlDoUp(): Promise<string> {
    const { queryRunner, query } = criarQueryRunner();
    await new AddAppointmentsNoOverlapConstraint1755800900000().up(queryRunner);
    return executadas(query).find((sql) => sql.includes('ADD CONSTRAINT'))!;
  }

  const statusEntreAspas = (sql: string) =>
    [...sql.matchAll(/'([a-z_]+)'/g)].map(([, status]) => status);

  it('verifica o dado, nomeia as FKs, habilita btree_gist e cria a constraint', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddAppointmentsNoOverlapConstraint1755800900000().up(queryRunner);

    expect(executadas(query)).toEqual([
      CONSULTAS_SOBREPOSTAS.sql,
      EXTENSAO_BTREE_GIST.sql,
      'ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_clinic_id_fkey" TO "FK_appointments_clinic"',
      'ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_room_id_fkey" TO "FK_appointments_room"',
      'ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_health_plan_id_fkey" TO "FK_appointments_health_plan"',
      'ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_created_by_id_fkey" TO "FK_appointments_created_by"',
      'CREATE EXTENSION IF NOT EXISTS btree_gist',
      expect.stringContaining('EXCLUDE USING gist'),
    ]);
  });

  it('FK já renomeada é pulada; FK ausente aborta', async () => {
    const jaRenomeada = criarQueryRunner([], {
      room_id: 'FK_appointments_room',
    });
    await new AddAppointmentsNoOverlapConstraint1755800900000().up(
      jaRenomeada.queryRunner,
    );
    expect(
      executadas(jaRenomeada.query).some((sql) =>
        sql.includes('"appointments_room_id_fkey"'),
      ),
    ).toBe(false);

    const ausente = criarQueryRunner([], { health_plan_id: null });
    await expect(
      new AddAppointmentsNoOverlapConstraint1755800900000().up(
        ausente.queryRunner,
      ),
    ).rejects.toThrow(/health_plan_id/);
    expect(
      executadas(ausente.query).some((sql) => sql.includes('EXCLUDE')),
    ).toBe(false);
  });

  it('os nomes das FKs batem com foreignKeyConstraintName da entidade', () => {
    const nomes = getMetadataArgsStorage()
      .joinColumns.filter((j) => j.target === Appointment)
      .map((j) => j.foreignKeyConstraintName);

    expect(nomes).toEqual(
      expect.arrayContaining([
        'FK_appointments_clinic',
        'FK_appointments_room',
        'FK_appointments_health_plan',
        'FK_appointments_created_by',
      ]),
    );
  });

  it('aborta sem tocar no schema quando há consultas sobrepostas', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { chave: 'médico d1 em 2026-10-07', ids: 'ap-1, ap-2' },
    ]);

    await expect(
      new AddAppointmentsNoOverlapConstraint1755800900000().up(queryRunner),
    ).rejects.toThrow(/ap-1, ap-2/);
    expect(executadas(query)).toEqual([CONSULTAS_SOBREPOSTAS.sql]);
  });

  it('aborta com diagnóstico, antes de qualquer DDL, quando btree_gist não pode ser criada', async () => {
    const { queryRunner, query } = criarQueryRunner([], {}, [
      {
        chave:
          'o usuário inexci não tem permissão para criar a extensão btree_gist neste banco',
        ids: 'btree_gist',
      },
    ]);

    await expect(
      new AddAppointmentsNoOverlapConstraint1755800900000().up(queryRunner),
    ).rejects.toThrow(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
    expect(executadas(query)).toEqual([
      CONSULTAS_SOBREPOSTAS.sql,
      EXTENSAO_BTREE_GIST.sql,
    ]);
  });

  it('o SQL da migration é exatamente o @Exclusion da entidade', async () => {
    const exclusao = getMetadataArgsStorage().exclusions.find(
      (e) => e.target === Appointment,
    );

    expect(exclusao?.name).toBe(APPOINTMENTS_NO_OVERLAP_CONSTRAINT);
    expect(exclusao?.expression).toBe(APPOINTMENTS_NO_OVERLAP_EXCLUSION);
    expect(await sqlDoUp()).toBe(
      `ALTER TABLE "appointments" ADD CONSTRAINT "${APPOINTMENTS_NO_OVERLAP_CONSTRAINT}" EXCLUDE ${APPOINTMENTS_NO_OVERLAP_EXCLUSION}`,
    );
  });

  it('a lista de status da constraint é OCCUPYING_APPOINTMENT_STATUSES', async () => {
    const where = (await sqlDoUp()).split('WHERE')[1];

    expect(statusEntreAspas(where).sort()).toEqual(
      [...OCCUPYING_APPOINTMENT_STATUSES].sort(),
    );
  });

  it('a verificação pré-migration usa a mesma lista de status', () => {
    expect(statusEntreAspas(STATUS_QUE_OCUPAM_A_AGENDA_SQL).sort()).toEqual(
      [...OCCUPYING_APPOINTMENT_STATUSES].sort(),
    );
    expect(CONSULTAS_SOBREPOSTAS.sql).toContain('NOT a."is_walk_in"');
    expect(CONSULTAS_SOBREPOSTAS.sql).toContain('a."deleted_at" IS NULL');
  });

  it('a verificação é read-only e roda no pré-flight de deploy', () => {
    expect(CONSULTAS_SOBREPOSTAS.sql).toMatch(/^\s*SELECT/i);
    expect(CONSULTAS_SOBREPOSTAS.sql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
    );
    expect(VERIFICACOES_PRE_MIGRATION).toContain(CONSULTAS_SOBREPOSTAS);
  });

  it('down derruba só a constraint (não a extensão) e devolve os nomes automáticos', async () => {
    const { queryRunner, query } = criarQueryRunner([], {
      clinic_id: 'FK_appointments_clinic',
      room_id: 'FK_appointments_room',
      health_plan_id: 'FK_appointments_health_plan',
      created_by_id: 'FK_appointments_created_by',
    });

    await new AddAppointmentsNoOverlapConstraint1755800900000().down(
      queryRunner,
    );

    expect(executadas(query)).toEqual([
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "${APPOINTMENTS_NO_OVERLAP_CONSTRAINT}"`,
      'ALTER TABLE "appointments" RENAME CONSTRAINT "FK_appointments_created_by" TO "appointments_created_by_id_fkey"',
      'ALTER TABLE "appointments" RENAME CONSTRAINT "FK_appointments_health_plan" TO "appointments_health_plan_id_fkey"',
      'ALTER TABLE "appointments" RENAME CONSTRAINT "FK_appointments_room" TO "appointments_room_id_fkey"',
      'ALTER TABLE "appointments" RENAME CONSTRAINT "FK_appointments_clinic" TO "appointments_clinic_id_fkey"',
    ]);
  });
});
