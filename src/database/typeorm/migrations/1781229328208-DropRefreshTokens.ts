import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove a tabela `refresh_tokens`.
 *
 * Os refresh tokens passaram a viver no Redis (apenas o hash SHA-256, com TTL
 * nativo de 7 dias) — ver `RefreshTokenStore`. A persistência em Postgres
 * guardava o token cru e adicionava ~650ms de latência por refresh.
 *
 * Impacto: as sessões ativas que dependiam dos tokens antigos caem uma vez
 * (relogin). O `down` recria a estrutura original para permitir reversão.
 */
export class DropRefreshTokens1781229328208 implements MigrationInterface {
  name = 'DropRefreshTokens1781229328208';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens";`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    UUID NOT NULL,
        "token"      VARCHAR(512) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "revoked"    BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "uq_refresh_tokens_token" UNIQUE ("token"),
        CONSTRAINT "fk_refresh_tokens_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_revoked" ON "refresh_tokens" ("revoked");`,
    );
  }
}
