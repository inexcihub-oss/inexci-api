import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshToken1740182400001 implements MigrationInterface {
  name = 'AddRefreshToken1740182400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_token" (
        "id"         uuid              NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    uuid              NOT NULL,
        "token"      character varying(512) NOT NULL,
        "expires_at" TIMESTAMP         NOT NULL,
        "revoked"    boolean           NOT NULL DEFAULT false,
        "created_at" TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_token" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_token_user" FOREIGN KEY ("user_id")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_refresh_token_token" ON "refresh_token" ("token")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_refresh_token_user_id" ON "refresh_token" ("user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_refresh_token_revoked" ON "refresh_token" ("revoked")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_token_revoked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_token_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_refresh_token_token"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_token" CASCADE`);
  }
}
