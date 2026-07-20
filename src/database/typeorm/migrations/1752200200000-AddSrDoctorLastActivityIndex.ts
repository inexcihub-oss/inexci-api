import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `findMany` (kanban/listagem) filtra por `doctor_id IN (...)` e ordena por
 * `last_activity_at DESC`. Havia `idx_sr_doctor_status` (doctor_id, status) e
 * `idx_sr_status`, mas nenhum índice composto cobrindo a ordenação — a busca
 * podia cair em sort em memória. `DESC` explícito porque o decorator
 * `@Index` do TypeORM não expressa sort order por coluna.
 */
export class AddSrDoctorLastActivityIndex1752200200000 implements MigrationInterface {
  name = 'AddSrDoctorLastActivityIndex1752200200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS: o índice pode já ter sido criado manualmente (ex.: teste
    // exploratório via SQL direto) sem que o TypeORM tivesse registrado a
    // migration como executada — idempotente evita falhar nesse cenário.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sr_doctor_last_activity" ON "surgery_requests" ("doctor_id", "last_activity_at" DESC);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_sr_doctor_last_activity";`,
    );
  }
}
