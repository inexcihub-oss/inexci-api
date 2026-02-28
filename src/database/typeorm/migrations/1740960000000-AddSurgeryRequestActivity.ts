import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela surgery_request_activity para registro de
 * comentários manuais, histórico de status e eventos de sistema
 * vinculados a uma solicitação cirúrgica.
 */
export class AddSurgeryRequestActivity1740960000000 implements MigrationInterface {
  name = 'AddSurgeryRequestActivity1740960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cria o tipo enum se não existir
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "activity_type_enum" AS ENUM ('comment', 'status_change', 'system');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE "surgery_request_activity" (
        "id"                   UUID        NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"   UUID        NOT NULL,
        "user_id"              UUID,
        "type"                 "activity_type_enum" NOT NULL DEFAULT 'comment',
        "content"              TEXT        NOT NULL,
        "created_at"           TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_activity" PRIMARY KEY ("id"),
        CONSTRAINT "FK_activity_surgery_request"
          FOREIGN KEY ("surgery_request_id")
          REFERENCES "surgery_request"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_activity_user"
          FOREIGN KEY ("user_id")
          REFERENCES "user"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_activity_surgery_request_id"
        ON "surgery_request_activity" ("surgery_request_id");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_activity_created_at"
        ON "surgery_request_activity" ("created_at" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_request_activity"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "activity_type_enum"`);
  }
}
