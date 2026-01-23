import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendencySystemFields1768712500000 implements MigrationInterface {
  name = 'AddPendencySystemFields1768712500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adicionar novos campos na tabela pendency
    await queryRunner.query(
      `ALTER TABLE "pendency" ADD COLUMN IF NOT EXISTS "responsible_type" character varying(20) NOT NULL DEFAULT 'collaborator'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pendency" ADD COLUMN IF NOT EXISTS "is_optional" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pendency" ADD COLUMN IF NOT EXISTS "is_waiting" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pendency" ADD COLUMN IF NOT EXISTS "status_context" smallint`,
    );

    // Adicionar novos campos na tabela surgery_request
    await queryRunner.query(
      `ALTER TABLE "surgery_request" ADD COLUMN IF NOT EXISTS "hospital_protocol" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" ADD COLUMN IF NOT EXISTS "health_plan_protocol" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" ADD COLUMN IF NOT EXISTS "surgery_description" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" ADD COLUMN IF NOT EXISTS "analysis_started_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" ADD COLUMN IF NOT EXISTS "selected_date_index" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remover campos da tabela surgery_request
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN IF EXISTS "selected_date_index"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN IF EXISTS "analysis_started_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN IF EXISTS "surgery_description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN IF EXISTS "health_plan_protocol"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN IF EXISTS "hospital_protocol"`,
    );

    // Remover campos da tabela pendency
    await queryRunner.query(
      `ALTER TABLE "pendency" DROP COLUMN IF EXISTS "status_context"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pendency" DROP COLUMN IF EXISTS "is_waiting"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pendency" DROP COLUMN IF EXISTS "is_optional"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pendency" DROP COLUMN IF EXISTS "responsible_type"`,
    );
  }
}
