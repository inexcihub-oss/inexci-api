import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  CONSULTAS_SOBREPOSTAS,
  EXTENSAO_BTREE_GIST,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

const FKS_A_RENOMEAR: { coluna: string; nome: string }[] = [
  { coluna: 'clinic_id', nome: 'FK_appointments_clinic' },
  { coluna: 'room_id', nome: 'FK_appointments_room' },
  { coluna: 'health_plan_id', nome: 'FK_appointments_health_plan' },
  { coluna: 'created_by_id', nome: 'FK_appointments_created_by' },
];

async function renomearFk(
  queryRunner: QueryRunner,
  coluna: string,
  destino: string,
): Promise<void> {
  const linhas = (await queryRunner.query(
    `SELECT c."conname" AS nome
       FROM "pg_constraint" c
       JOIN "pg_attribute" a
         ON a."attrelid" = c."conrelid" AND a."attnum" = ANY (c."conkey")
      WHERE c."conrelid" = '"appointments"'::regclass
        AND c."contype" = 'f'
        AND a."attname" = $1
        AND array_length(c."conkey", 1) = 1`,
    [coluna],
  )) as { nome: string }[] | undefined;

  if (!linhas || linhas.length !== 1) {
    throw new Error(
      `Esperava 1 chave estrangeira em "appointments"."${coluna}", encontrei ${linhas?.length ?? 0}.`,
    );
  }
  const atual = linhas[0].nome;
  if (atual === destino) return;

  await queryRunner.query(
    `ALTER TABLE "appointments" RENAME CONSTRAINT "${atual}" TO "${destino}"`,
  );
}

export class AddAppointmentsNoOverlapConstraint1755800900000 implements MigrationInterface {
  name = 'AddAppointmentsNoOverlapConstraint1755800900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(CONSULTAS_SOBREPOSTAS, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(CONSULTAS_SOBREPOSTAS, conflitos));
    }

    const semExtensao = await verificar(EXTENSAO_BTREE_GIST, (sql) =>
      queryRunner.query(sql),
    );
    if (semExtensao.length > 0) {
      throw new Error(montarDiagnostico(EXTENSAO_BTREE_GIST, semExtensao));
    }

    for (const { coluna, nome } of FKS_A_RENOMEAR) {
      await renomearFk(queryRunner, coluna, nome);
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "EX_appointments_doctor_no_overlap" EXCLUDE USING gist ("doctor_id" WITH =, tsrange(timezone('UTC', "scheduled_at"), timezone('UTC', "scheduled_at") + "duration_minutes" * interval '1 minute', '[)') WITH &&) WHERE ("status" IN ('scheduled', 'confirmed', 'waiting', 'in_progress', 'completed') AND NOT "is_walk_in" AND "deleted_at" IS NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "EX_appointments_doctor_no_overlap"`,
    );
    for (const { coluna } of [...FKS_A_RENOMEAR].reverse()) {
      await renomearFk(queryRunner, coluna, `appointments_${coluna}_fkey`);
    }
  }
}
