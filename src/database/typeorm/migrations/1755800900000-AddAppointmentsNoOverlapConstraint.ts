import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest.
import {
  CONSULTAS_SOBREPOSTAS,
  EXTENSAO_BTREE_GIST,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/**
 * Impede no banco duas consultas do mesmo médico em horários sobrepostos.
 *
 * O service já recusa o conflito (`assertNoOverlap`), mas é check-then-insert:
 * duas requisições simultâneas passam pela checagem antes de qualquer uma
 * gravar. A exclusion constraint fecha a corrida; o pré-check continua para
 * devolver a mensagem amigável, e o service traduz o `23P01` na mesma 409.
 *
 * Predicado igual ao de `hasOverlap`, com uma diferença deliberada: encaixe
 * fica de fora da constraint (é marcado de propósito em cima de outro
 * horário). Consulta normal sobre encaixe continua barrada só pelo pré-check.
 *
 * - `btree_gist` dá ao GiST o operador `=` para `uuid` (`doctor_id WITH =`).
 *   É extensão "trusted" desde o PG 13 e vem no contrib da imagem oficial.
 *   Mesmo assim `EXTENSAO_BTREE_GIST` confere antes (aqui e no pré-flight):
 *   servidor sem contrib ou usuário sem permissão abortam com diagnóstico.
 * - `timezone('UTC', …)` converte `timestamptz` em `timestamp`: `timestamptz +
 *   interval` é só STABLE, e constraint exige expressão IMMUTABLE.
 * - A lista de status TEM que bater com `OCCUPYING_APPOINTMENT_STATUSES`; o
 *   texto inteiro tem que bater com `APPOINTMENTS_NO_OVERLAP_EXCLUSION` (o
 *   `@Exclusion` da entidade, que impede o `migration:generate` de derrubá-la).
 *   `add-appointments-no-overlap-constraint.migration.spec.ts` garante os dois.
 */
/**
 * De carona, nomes explícitos para as FKs de `appointments` que foram
 * declaradas inline (`REFERENCES ...`) e batizadas pelo Postgres
 * (`appointments_<coluna>_fkey`) — o mesmo acerto de
 * `AddMissingForeignKeyIndexes1755800800000` para as outras tabelas. O TypeORM
 * compara FK por nome; sem isso, `migration:generate` derrubaria e recriaria
 * cada uma. Os nomes batem com `foreignKeyConstraintName` na entidade.
 */
const FKS_A_RENOMEAR: { coluna: string; nome: string }[] = [
  { coluna: 'clinic_id', nome: 'FK_appointments_clinic' },
  { coluna: 'room_id', nome: 'FK_appointments_room' },
  { coluna: 'health_plan_id', nome: 'FK_appointments_health_plan' },
  { coluna: 'created_by_id', nome: 'FK_appointments_created_by' },
];

/**
 * Renomeia a FK de uma coluna só de `appointments` para `destino`, achando-a
 * pela coluna (não pelo nome automático). Já renomeada: nada a fazer. Ausente
 * ou ambígua: aborta — o schema não é o que as migrations anteriores deixaram.
 */
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

    // Antes de qualquer DDL: sem o contrib ou sem permissão para criar a
    // extensão, o `CREATE EXTENSION` falharia com o erro cru do Postgres.
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

  /**
   * Derruba a constraint e devolve os nomes automáticos das FKs. A extensão
   * fica: outra coisa pode ter passado a depender dela, e mantê-la não tem
   * efeito colateral.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "EX_appointments_doctor_no_overlap"`,
    );
    for (const { coluna } of [...FKS_A_RENOMEAR].reverse()) {
      await renomearFk(queryRunner, coluna, `appointments_${coluna}_fkey`);
    }
  }
}
